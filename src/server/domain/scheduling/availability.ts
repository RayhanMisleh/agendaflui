import type { TenantContext } from '@/server/auth/actor'
import { DomainError, parse, z } from '@/server/domain/errors'
import { isCustomer } from '@/server/domain/input'
import { isClosedOn, listClosures } from '@/server/domain/settings/closures'
import { getSchedulingRules, type SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { ACTIVE_STATUSES } from '@/server/domain/scheduling/status'
import { computeSlots, type Interval, type WorkingRange } from '@/server/domain/scheduling/slots'
import { toServiceView, type ServiceView } from '@/server/domain/catalog/services'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import {
  addDays,
  addMinutes,
  compareLocalDates,
  formatTimeDistinct,
  isLocalDate,
  localDayRange,
  todayIn,
  weekdayOf,
  type Weekday,
} from '@/server/time'

/** `label` é o horário local pronto; pode repetir-se na hora repetida do horário de verão, e então traz "(1ª vez)" ou "(2ª vez)". */
export type SlotView = { startsAt: Date; label: string; professionalIds: string[] }
export type AvailabilityView = { date: string; durationMin: number; totalCents: number; slots: SlotView[] }
export type DayOccupancy = { workingRanges: WorkingRange[]; busy: Interval[]; blocked: Interval[] }

const MAX_SERVICES = 10
const MAX_TOTAL_MIN = 720
const STAFF_WINDOW_DAYS = 365

type Db = TenantClient | TenantTx

const localDate = z.string().refine(isLocalDate, 'Use uma data válida no formato AAAA-MM-DD.')
const uuid = z.uuid()

function invalidServices(message: string): DomainError {
  return new DomainError('validation', message, { fields: { serviceIds: message } })
}

const serviceIdsSchema = z.object({
  serviceIds: z
    .array(z.string())
    .min(1, 'Escolha pelo menos um serviço.')
    .max(MAX_SERVICES, `Escolha no máximo ${MAX_SERVICES} serviços por atendimento.`)
    .refine(
      (ids) => ids.every((id) => uuid.safeParse(id).success),
      'Um dos serviços escolhidos não é válido. Escolha de novo.',
    )
    .refine((ids) => new Set(ids).size === ids.length, 'Há serviços repetidos na lista. Escolha cada serviço uma vez.'),
})

/** Valida a lista e devolve os serviços na ordem pedida, com duração e total somados. */
export async function resolveServices(
  ctx: TenantContext,
  serviceIds: string[],
  db: Db = ctx.db,
): Promise<{ items: ServiceView[]; durationMin: number; totalCents: number }> {
  const ids = parse(serviceIdsSchema, { serviceIds }).serviceIds

  const rows = await db.service.findMany({
    where: { id: { in: ids }, active: true, archivedAt: null },
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const items: ServiceView[] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) throw invalidServices('Um dos serviços não está disponível. Escolha outro e tente de novo.')
    items.push(toServiceView(row))
  }

  const durationMin = items.reduce((sum, item) => sum + item.durationMin, 0)
  if (durationMin > MAX_TOTAL_MIN) {
    throw invalidServices(`Os serviços somam mais de ${MAX_TOTAL_MIN / 60} horas. Escolha menos serviços.`)
  }

  if (isCustomer(ctx) && items.some((item) => item.clubOnly)) {
    // O visitante (sem login) é tratado como cliente comum, sem clube.
    const customer =
      ctx.actor.kind === 'customer'
        ? await db.customer.findFirst({
            where: { id: ctx.actor.customerId, archivedAt: null, anonymizedAt: null },
            select: { isClubMember: true },
          })
        : { isClubMember: false }
    if (!customer) {
      throw new DomainError('forbidden', 'Seu cadastro não está ativo. Fale com o estabelecimento.', {
        reason: 'customer_inactive',
      })
    }
    if (!customer.isClubMember) {
      throw new DomainError('forbidden', 'Um dos serviços é exclusivo do clube. Escolha outro serviço.', {
        reason: 'club_only',
      })
    }
  }

  return { items, durationMin, totalCents: items.reduce((sum, item) => sum + item.priceCents, 0) }
}

const occupancySchema = z.object({
  professionalIds: z.array(z.uuid('Escolha profissionais válidos.')),
  date: localDate,
  bufferMin: z.number().int().min(0),
  ignoreAppointmentId: z.uuid('Agendamento inválido.').optional(),
})

type RangeRows = {
  hours: { professionalId: string; weekday: Weekday; startMin: number; endMin: number }[]
  appointments: { professionalId: string; startsAt: Date; endsAt: Date }[]
  blocks: { professionalId: string; startsAt: Date; endsAt: Date }[]
}

/**
 * Carrega, com uma consulta por tabela, o expediente (dos dias da semana presentes), os agendamentos ativos
 * e os bloqueios dos profissionais nos dias locais dados (já validados, em ordem). Os agendamentos entram
 * com margem de `bufferMin` para a folga funcionar na borda dos dias. É a única regra de "o que ocupa".
 */
async function loadRangeRows(
  ctx: TenantContext,
  q: { professionalIds: string[]; dates: string[]; bufferMin: number; ignoreAppointmentId?: string },
  db: Db,
): Promise<RangeRows> {
  const first = q.dates[0]
  const last = q.dates[q.dates.length - 1]
  if (q.professionalIds.length === 0 || first === undefined || last === undefined) {
    return { hours: [], appointments: [], blocks: [] }
  }
  const start = localDayRange(first, ctx.timeZone).start
  const end = localDayRange(last, ctx.timeZone).end
  // Em sequência: dentro de uma transação, o cliente do banco atende uma consulta por vez.
  const hours = await db.workingHours.findMany({
    where: { professionalId: { in: q.professionalIds }, weekday: { in: [...new Set(q.dates.map(weekdayOf))] } },
    orderBy: [{ startMin: 'asc' }, { id: 'asc' }],
  })
  const appointments = await db.appointment.findMany({
    where: {
      professionalId: { in: q.professionalIds },
      status: { in: [...ACTIVE_STATUSES] },
      startsAt: { lt: addMinutes(end, q.bufferMin) },
      endsAt: { gt: addMinutes(start, -q.bufferMin) },
      ...(q.ignoreAppointmentId ? { id: { not: q.ignoreAppointmentId } } : {}),
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  const blocks = await db.timeBlock.findMany({
    where: {
      professionalId: { in: q.professionalIds },
      startsAt: { lt: end },
      endsAt: { gt: start },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  return { hours, appointments, blocks }
}

/** Recorta o que `loadRangeRows` trouxe para um dia local. */
function dayOccupancyFrom(
  ctx: TenantContext,
  rows: RangeRows,
  professionalIds: string[],
  date: string,
  bufferMin: number,
): Map<string, DayOccupancy> {
  const result = new Map<string, DayOccupancy>()
  for (const id of professionalIds) result.set(id, { workingRanges: [], busy: [], blocked: [] })
  const day = localDayRange(date, ctx.timeZone)
  const weekday = weekdayOf(date)
  const busyFrom = addMinutes(day.start, -bufferMin)
  const busyTo = addMinutes(day.end, bufferMin)
  for (const h of rows.hours) {
    if (h.weekday === weekday) result.get(h.professionalId)?.workingRanges.push({ startMin: h.startMin, endMin: h.endMin })
  }
  for (const a of rows.appointments) {
    if (a.startsAt < busyTo && a.endsAt > busyFrom) result.get(a.professionalId)?.busy.push({ start: a.startsAt, end: a.endsAt })
  }
  for (const b of rows.blocks) {
    if (b.startsAt < day.end && b.endsAt > day.start) result.get(b.professionalId)?.blocked.push({ start: b.startsAt, end: b.endsAt })
  }
  return result
}

/**
 * Expediente, agendamentos ativos e bloqueios de cada profissional no dia local, com uma consulta por tabela.
 * Os agendamentos são carregados com margem de `bufferMin` para a folga funcionar na borda do dia.
 */
export async function loadDayOccupancy(
  ctx: TenantContext,
  q: { professionalIds: string[]; date: string; bufferMin: number; ignoreAppointmentId?: string },
  db: Db = ctx.db,
): Promise<Map<string, DayOccupancy>> {
  const { professionalIds, date, bufferMin, ignoreAppointmentId } = parse(occupancySchema, q)
  const rows = await loadRangeRows(
    ctx,
    { professionalIds, dates: [date], bufferMin, ...(ignoreAppointmentId ? { ignoreAppointmentId } : {}) },
    db,
  )
  return dayOccupancyFrom(ctx, rows, professionalIds, date, bufferMin)
}

const availabilitySchema = z.object({
  date: localDate,
  professionalId: z.string().nullish(),
})

function invalidProfessional(): DomainError {
  const message = 'Este profissional não está disponível para esses serviços.'
  return new DomainError('validation', message, { fields: { professionalId: message } })
}

export type Candidate = { id: string; displayOrder: number }

/** Profissionais ativos que fazem todos os serviços, na ordem de exibição. `serviceIds` já validados. */
export async function listCandidates(ctx: TenantContext, serviceIds: string[], db: Db = ctx.db): Promise<Candidate[]> {
  return db.professional.findMany({
    where: {
      active: true,
      archivedAt: null,
      AND: serviceIds.map((serviceId) => ({ services: { some: { serviceId } } })),
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true, displayOrder: true },
  })
}

export type FreeStart = { startsAt: Date; professionalIds: string[] }

/**
 * Inícios livres do dia a partir da ocupação já carregada: antecedência e alcance (só para o cliente do
 * app), grade e folga. A mesma conta serve à consulta do dia, à marcação e à lista de dias livres.
 */
function startsFromOccupancy(
  ctx: TenantContext,
  i: { date: string; durationMin: number; professionalIds: string[]; rules: SchedulingRules },
  occupancy: Map<string, DayOccupancy>,
): Map<number, FreeStart> {
  const starts = new Map<number, FreeStart>()
  const { date, rules } = i
  const now = ctx.clock()
  const today = todayIn(ctx.timeZone, now)
  const customer = isCustomer(ctx)
  const notBefore = customer ? addMinutes(now, rules.minLeadMin) : now
  const notAfter = customer
    ? localDayRange(addDays(today, rules.maxAdvanceDays), ctx.timeZone).end
    : addMinutes(now, STAFF_WINDOW_DAYS * 24 * 60)

  for (const id of i.professionalIds) {
    const o = occupancy.get(id)
    if (!o) continue
    const free = computeSlots({
      date,
      timeZone: ctx.timeZone,
      workingRanges: o.workingRanges,
      busy: o.busy,
      blocked: o.blocked,
      durationMin: i.durationMin,
      stepMin: rules.slotStepMin,
      bufferMin: rules.bufferMin,
      notBefore,
      notAfter,
    })
    for (const startsAt of free) {
      const entry = starts.get(startsAt.getTime())
      if (entry) entry.professionalIds.push(id)
      else starts.set(startsAt.getTime(), { startsAt, professionalIds: [id] })
    }
  }
  return starts
}

/**
 * Inícios livres do dia local para a duração dada, por instante (milissegundos), com os profissionais
 * livres em cada um (na ordem de `professionalIds`). Aplica fechamento, antecedência e alcance (só para
 * o cliente do app) e a folga. A mesma conta serve à consulta e à marcação.
 */
export async function computeFreeStarts(
  ctx: TenantContext,
  i: {
    date: string
    durationMin: number
    professionalIds: string[]
    rules: SchedulingRules
    ignoreAppointmentId?: string
  },
  db: Db = ctx.db,
): Promise<Map<number, FreeStart>> {
  const { date, rules } = i
  const today = todayIn(ctx.timeZone, ctx.clock())
  if (i.professionalIds.length === 0 || compareLocalDates(date, today) < 0) return new Map()
  if (await isClosedOn(ctx, date, db)) return new Map()

  const occupancy = await loadDayOccupancy(
    ctx,
    {
      professionalIds: i.professionalIds,
      date,
      bufferMin: rules.bufferMin,
      ...(i.ignoreAppointmentId ? { ignoreAppointmentId: i.ignoreAppointmentId } : {}),
    },
    db,
  )
  return startsFromOccupancy(ctx, { date, durationMin: i.durationMin, professionalIds: i.professionalIds, rules }, occupancy)
}

/** Profissionais que fazem todos os serviços; com `professionalId`, só ele (ou erro de validação). */
async function chooseProfessionals(ctx: TenantContext, serviceIds: string[], professionalId?: string | null): Promise<string[]> {
  const candidates = (await listCandidates(ctx, serviceIds)).map((p) => p.id)
  if (!professionalId) return candidates
  if (!candidates.includes(professionalId)) throw invalidProfessional()
  return [professionalId]
}

/** Inícios livres no dia local para os serviços escolhidos; cada início traz os profissionais livres nele. */
export async function getAvailability(
  ctx: TenantContext,
  q: { date: string; serviceIds: string[]; professionalId?: string | null },
): Promise<AvailabilityView> {
  const { date, professionalId } = parse(availabilitySchema, { date: q.date, professionalId: q.professionalId })
  const { durationMin, totalCents } = await resolveServices(ctx, q.serviceIds)
  const view = (slots: SlotView[]): AvailabilityView => ({ date, durationMin, totalCents, slots })

  const chosen = await chooseProfessionals(ctx, q.serviceIds, professionalId)

  const rules = await getSchedulingRules(ctx)
  const starts = await computeFreeStarts(ctx, { date, durationMin, professionalIds: chosen, rules })
  return view(
    [...starts.values()]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((s) => ({ startsAt: s.startsAt, label: formatTimeDistinct(s.startsAt, ctx.timeZone), professionalIds: s.professionalIds })),
  )
}

export const MAX_AVAILABLE_DAYS = 31

const daysSchema = z.object({ from: localDate, to: localDate, professionalId: z.string().nullish() })

export type AvailableDay = { date: string; weekday: Weekday; available: boolean }

/**
 * Para cada dia local do intervalo (até 31 dias), se há pelo menos um início livre para os serviços
 * escolhidos. A ocupação e os fechamentos do intervalo inteiro são carregados de uma vez: o número de
 * consultas não depende da quantidade de dias.
 */
export async function listAvailableDays(
  ctx: TenantContext,
  q: { from: string; to: string; serviceIds: string[]; professionalId?: string | null },
): Promise<AvailableDay[]> {
  const { from, to, professionalId } = parse(daysSchema, { from: q.from, to: q.to, professionalId: q.professionalId })
  const dates: string[] = []
  for (let date = from; compareLocalDates(date, to) <= 0 && dates.length <= MAX_AVAILABLE_DAYS; date = addDays(date, 1)) {
    dates.push(date)
  }
  if (dates.length === 0) {
    const message = 'A data final não pode ser anterior à inicial.'
    throw new DomainError('validation', message, { fields: { to: message } })
  }
  if (dates.length > MAX_AVAILABLE_DAYS) {
    const message = `Peça no máximo ${MAX_AVAILABLE_DAYS} dias por vez.`
    throw new DomainError('validation', message, { fields: { to: message } })
  }
  const { durationMin } = await resolveServices(ctx, q.serviceIds)
  const chosen = await chooseProfessionals(ctx, q.serviceIds, professionalId)

  const rules = await getSchedulingRules(ctx)
  const today = todayIn(ctx.timeZone, ctx.clock())
  const closures = await listClosures(ctx, { from, to })
  const closed = (date: string): boolean =>
    closures.some((c) => compareLocalDates(c.startDate, date) <= 0 && compareLocalDates(c.endDate, date) >= 0)
  const rows = await loadRangeRows(ctx, { professionalIds: chosen, dates, bufferMin: rules.bufferMin }, ctx.db)

  return dates.map((date) => {
    const weekday = weekdayOf(date)
    if (chosen.length === 0 || compareLocalDates(date, today) < 0 || closed(date)) {
      return { date, weekday, available: false }
    }
    const occupancy = dayOccupancyFrom(ctx, rows, chosen, date, rules.bufferMin)
    const starts = startsFromOccupancy(ctx, { date, durationMin, professionalIds: chosen, rules }, occupancy)
    return { date, weekday, available: starts.size > 0 }
  })
}
