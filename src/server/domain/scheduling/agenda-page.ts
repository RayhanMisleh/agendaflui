import type { TenantContext } from '@/server/auth/actor'
import type { AppointmentStatus } from '@/server/db/generated/client'
import { listServices } from '@/server/domain/catalog/services'
import { authorize } from '@/server/domain/errors'
import { getAgenda, getDaySummary, type AgendaDay } from '@/server/domain/scheduling/agenda'
import { actorKind, staffScope, type AppointmentView } from '@/server/domain/scheduling/appointment-view'
import {
  dayWindow,
  freeGaps,
  layoutDay,
  minutesOfSpan,
  type MinuteRange,
  type SlipBox,
} from '@/server/domain/scheduling/agenda-layout'
import { ACTIVE_STATUSES, OPEN_STATUSES } from '@/server/domain/scheduling/status'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { listProfessionals } from '@/server/domain/team/professionals'
import {
  addDays,
  compareLocalDates,
  isLocalDate,
  isoWeekRange,
  localDayRange,
  minuteLabel,
  minuteOfDay,
  parseMinuteLabel,
  todayIn,
  weekdayOf,
  type Weekday,
} from '@/server/time'

/*
 * Tudo o que a página da agenda mostra, pronto para a tela: a URL define a visão (`visao`, `data`, `profissional`), "hoje"
 * vem do relógio da conta, e cada horário chega como rótulo local mais a posição em minutos desde o começo da janela do
 * dia. A tela não converte fuso, não decide permissão nem conflito.
 */

export type AgendaQuery = { visao?: string | undefined; data?: string | undefined; profissional?: string | undefined }

export type PageSlip = {
  id: string
  professionalId: string
  status: AppointmentStatus
  customerName: string
  services: string
  startLabel: string
  endLabel: string
  box: SlipBox
  /** Pede atenção: pendente de confirmação ou o próximo atendimento de hoje. */
  attention: boolean
  /** Pode ser arrastado para outro horário (aberto e na agenda que a pessoa gerencia). */
  draggable: boolean
}

export type PageBlock = { id: string; startLabel: string; endLabel: string; topMin: number; heightMin: number; label: string }
export type PageGap = { startMin: number; endMin: number; startLabel: string; endLabel: string }

export type PageColumn = {
  id: string
  name: string
  inactive: boolean
  slips: PageSlip[]
  blocks: PageBlock[]
  gaps: PageGap[]
}

export type PageDay = {
  startMin: number
  endMin: number
  hours: { min: number; label: string }[]
  columns: PageColumn[]
  /** Minuto de agora no relógio da conta, só quando a data é hoje. */
  nowMin: number | null
  summary: { total: number; completed: number; occupancy: number | null }
}

export type PageWeekDay = {
  date: string
  weekday: Weekday
  isToday: boolean
  closed: boolean
  count: number
  occupancy: number | null
  items: { id: string; startLabel: string; customerName: string; status: AppointmentStatus }[]
  more: number
}

export type PageDetail = {
  id: string
  status: AppointmentStatus
  date: string
  startLabel: string
  endLabel: string
  customer: { id: string; name: string; phoneLabel: string | null }
  professional: { id: string; name: string }
  items: { serviceId: string; name: string; priceCents: number; durationMin: number }[]
  totalCents: number
  totalDurationMin: number
  notes: string | null
  customerNote: string | null
  /** Confirmado, hoje e ainda não começou: dá para avisar que o profissional já está livre. */
  canFreeEarly: boolean
}

export type AgendaPage = {
  view: 'dia' | 'semana'
  date: string
  weekday: Weekday
  today: string
  prevDate: string
  nextDate: string
  /** Grade da conta, em minutos. */
  step: number
  scope: 'all' | 'own'
  /** Profissional sem ficha ligada ao acesso: não há agenda para mostrar. */
  unlinked: boolean
  ownProfessionalId: string | null
  professionals: { id: string; name: string }[]
  /** `todos` ou o id de um profissional. */
  filter: string
  closed: { closed: boolean; reason: string | null }
  day: PageDay | null
  week: PageWeekDay[] | null
  details: Record<string, PageDetail>
  services: { id: string; name: string; priceCents: number; durationMin: number }[]
}

const WEEK_ITEMS = 4

function spanOf(ctx: TenantContext, a: { startsAt: Date; endsAt: Date; totalDurationMin: number }, range: { start: Date; end: Date }): MinuteRange {
  const startMin = a.startsAt <= range.start ? 0 : minuteOfDay(a.startsAt, ctx.timeZone)
  const endMin = a.endsAt >= range.end ? 1440 : minuteOfDay(a.endsAt, ctx.timeZone)
  return minutesOfSpan({ startMin, endMin }, a.totalDurationMin)
}

function detailOf(a: AppointmentView, canFreeEarly: boolean): PageDetail {
  return {
    id: a.id,
    status: a.status,
    date: a.local.date,
    startLabel: a.local.start,
    endLabel: a.local.end,
    customer: a.customer,
    professional: a.professional,
    items: a.items,
    totalCents: a.totalCents,
    totalDurationMin: a.totalDurationMin,
    notes: a.notes ?? null,
    customerNote: a.customerNote,
    canFreeEarly,
  }
}

export async function getAgendaPage(ctx: TenantContext, q: AgendaQuery): Promise<AgendaPage> {
  authorize(ctx, 'view_own_agenda')
  const who = actorKind(ctx)
  const scope = await staffScope(ctx, who)
  const now = ctx.clock()
  const today = todayIn(ctx.timeZone, now)
  const view: 'dia' | 'semana' = q.visao === 'semana' ? 'semana' : 'dia'
  const date = q.data !== undefined && isLocalDate(q.data) ? q.data : today

  const everyone = await listProfessionals(ctx)
  const professionals = (scope.all ? everyone : everyone.filter((p) => p.id === scope.ownId)).map((p) => ({ id: p.id, name: p.name }))
  const unlinked = !scope.all && scope.ownId === null
  // Quem não vê todas as agendas recebe sempre a própria, qualquer que seja o pedido.
  const filter = scope.all ? (professionals.some((p) => p.id === q.profissional) ? (q.profissional ?? 'todos') : 'todos') : (scope.ownId ?? 'todos')
  const professionalId = filter === 'todos' ? null : filter

  const rules = await getSchedulingRules(ctx)
  const services = (await listServices(ctx)).map((s) => ({ id: s.id, name: s.name, priceCents: s.priceCents, durationMin: s.durationMin }))
  const base = {
    view,
    date,
    weekday: weekdayOf(date),
    today,
    prevDate: addDays(date, view === 'semana' ? -7 : -1),
    nextDate: addDays(date, view === 'semana' ? 7 : 1),
    step: rules.slotStepMin,
    scope: scope.all ? ('all' as const) : ('own' as const),
    unlinked,
    ownProfessionalId: scope.ownId,
    professionals,
    filter,
    services,
  }
  if (unlinked) {
    return { ...base, closed: { closed: false, reason: null }, day: null, week: null, details: {} }
  }

  if (view === 'semana') {
    const { start, end } = isoWeekRange(date)
    const days = await getAgenda(ctx, { from: start, to: end, professionalId })
    const week: PageWeekDay[] = []
    for (const day of days) {
      const all = day.professionals.flatMap((p) => p.appointments).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      const summary = await getDaySummary(ctx, day.date, professionalId)
      week.push({
        date: day.date,
        weekday: day.weekday,
        isToday: day.date === today,
        closed: day.closed,
        count: all.length,
        occupancy: summary.occupancy,
        items: all.slice(0, WEEK_ITEMS).map((a) => ({ id: a.id, startLabel: a.local.start, customerName: a.customer.name, status: a.status })),
        more: Math.max(0, all.length - WEEK_ITEMS),
      })
    }
    return { ...base, closed: { closed: false, reason: null }, day: null, week, details: {} }
  }

  const [agendaDay] = await getAgenda(ctx, { from: date, to: date, professionalId })
  const summary = await getDaySummary(ctx, date, professionalId)
  if (!agendaDay) return { ...base, closed: { closed: false, reason: null }, day: null, week: null, details: {} }
  const built = buildDay(ctx, agendaDay, { today, now, step: rules.slotStepMin, scope })
  return {
    ...base,
    closed: { closed: agendaDay.closed, reason: agendaDay.closureReason },
    day: { ...built.day, summary: { total: summary.total, completed: summary.byStatus.COMPLETED, occupancy: summary.occupancy } },
    week: null,
    details: built.details,
  }
}

function buildDay(
  ctx: TenantContext,
  agendaDay: AgendaDay,
  o: { today: string; now: Date; step: number; scope: { all: boolean; ownId: string | null } },
): { day: Omit<PageDay, 'summary'>; details: Record<string, PageDetail> } {
  const range = localDayRange(agendaDay.date, ctx.timeZone)
  const isToday = agendaDay.date === o.today
  const nowMin = isToday ? minuteOfDay(o.now, ctx.timeZone) : null

  // O próximo atendimento de hoje (aberto e ainda não terminado) pede atenção.
  const next = isToday
    ? agendaDay.professionals
        .flatMap((p) => p.appointments)
        .filter((a) => OPEN_STATUSES.includes(a.status) && a.endsAt.getTime() > o.now.getTime())
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))[0]
    : undefined

  const spans = new Map<string, MinuteRange>()
  const wanted: MinuteRange[] = []
  const blockSpans = new Map<string, MinuteRange>()
  for (const p of agendaDay.professionals) {
    for (const r of p.workingRanges) wanted.push({ startMin: r.startMin, endMin: r.endMin })
    for (const a of p.appointments) {
      const s = spanOf(ctx, a, range)
      spans.set(a.id, s)
      wanted.push(s)
    }
    for (const b of p.blocks) {
      const s = { startMin: parseMinuteLabel(b.local.startTime), endMin: parseMinuteLabel(b.local.endTime) }
      blockSpans.set(b.id, s)
      wanted.push(s)
    }
  }
  const window = dayWindow(wanted)

  const details: Record<string, PageDetail> = {}
  const columns: PageColumn[] = agendaDay.professionals.map((p) => {
    const own = o.scope.all || o.scope.ownId === p.id
    const boxes = new Map(
      layoutDay(
        p.appointments.map((a) => ({ id: a.id, ...(spans.get(a.id) ?? { startMin: 0, endMin: 0 }) })),
        window.startMin,
        window.endMin,
      ).map((b) => [b.id, b]),
    )
    const slips: PageSlip[] = []
    for (const a of p.appointments) {
      const box = boxes.get(a.id)
      const canFreeEarly = isToday && a.status === 'CONFIRMED' && a.startsAt.getTime() > o.now.getTime()
      details[a.id] = detailOf(a, canFreeEarly)
      if (!box) continue
      slips.push({
        id: a.id,
        professionalId: p.id,
        status: a.status,
        customerName: a.customer.name,
        services: a.items.map((i) => i.name).join(' + '),
        startLabel: a.local.start,
        endLabel: a.local.end,
        box,
        attention: a.status === 'PENDING' || next?.id === a.id,
        draggable: own && OPEN_STATUSES.includes(a.status),
      })
    }
    const blocks: PageBlock[] = p.blocks.flatMap((b) => {
      const s = blockSpans.get(b.id)
      if (!s) return []
      const top = Math.max(s.startMin, window.startMin)
      const bottom = Math.min(s.endMin, window.endMin)
      if (bottom <= top) return []
      return [{ id: b.id, startLabel: b.local.startTime, endLabel: b.local.endTime, topMin: top - window.startMin, heightMin: bottom - top, label: b.reason ?? 'Bloqueado' }]
    })
    const taken: MinuteRange[] = [
      ...p.appointments.filter((a) => ACTIVE_STATUSES.includes(a.status)).flatMap((a) => spans.get(a.id) ?? []),
      ...[...blockSpans.entries()].filter(([id]) => p.blocks.some((b) => b.id === id)).map(([, s]) => s),
    ]
    if (nowMin !== null) taken.push({ startMin: 0, endMin: nowMin })
    const past = compareLocalDates(agendaDay.date, o.today) < 0
    const gaps: PageGap[] =
      agendaDay.closed || past || !p.active || p.archived
        ? []
        : freeGaps(p.workingRanges, taken, o.step).map((g) => ({ ...g, startLabel: minuteLabel(g.startMin), endLabel: minuteLabel(g.endMin) }))
    return { id: p.id, name: p.name, inactive: !p.active || p.archived, slips, blocks, gaps }
  })

  const hours: { min: number; label: string }[] = []
  for (let m = Math.ceil(window.startMin / 60) * 60; m < window.endMin; m += 60) hours.push({ min: m, label: minuteLabel(m) })
  return { day: { startMin: window.startMin, endMin: window.endMin, hours, columns, nowMin }, details }
}
