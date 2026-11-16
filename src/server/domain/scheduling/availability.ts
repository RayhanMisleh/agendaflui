import type { TenantContext } from '@/server/auth/actor'
import { DomainError, parse, z } from '@/server/domain/errors'
import { isCustomer } from '@/server/domain/input'
import { isClosedOn } from '@/server/domain/settings/closures'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { computeSlots, type Interval, type WorkingRange } from '@/server/domain/scheduling/slots'
import type { ServiceView } from '@/server/domain/catalog/services'
import {
  addDays,
  addMinutes,
  compareLocalDates,
  formatTime,
  isLocalDate,
  localDayRange,
  todayIn,
  weekdayOf,
} from '@/server/time'

export type SlotView = { startsAt: Date; label: string; professionalIds: string[] }
export type AvailabilityView = { date: string; durationMin: number; totalCents: number; slots: SlotView[] }
export type DayOccupancy = { workingRanges: WorkingRange[]; busy: Interval[]; blocked: Interval[] }

const MAX_SERVICES = 10
const MAX_TOTAL_MIN = 720
const STAFF_WINDOW_DAYS = 365
/** Agendamentos que ocupam o horário do profissional. */
const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'] as const

const localDate = z.string().refine(isLocalDate, 'Use uma data válida no formato AAAA-MM-DD.')
const uuid = z.uuid()

function invalidServices(message: string): DomainError {
  return new DomainError('validation', message, { fields: { serviceIds: message } })
}

/** Valida a lista e devolve os serviços na ordem pedida, com duração e total somados. */
export async function resolveServices(
  ctx: TenantContext,
  serviceIds: string[],
): Promise<{ items: ServiceView[]; durationMin: number; totalCents: number }> {
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw invalidServices('Escolha pelo menos um serviço.')
  }
  if (serviceIds.length > MAX_SERVICES) {
    throw invalidServices(`Escolha no máximo ${MAX_SERVICES} serviços por atendimento.`)
  }
  if (!serviceIds.every((id) => uuid.safeParse(id).success)) {
    throw invalidServices('Um dos serviços escolhidos não é válido. Escolha de novo.')
  }
  if (new Set(serviceIds).size !== serviceIds.length) {
    throw invalidServices('Há serviços repetidos na lista. Escolha cada serviço uma vez.')
  }

  const rows = await ctx.db.service.findMany({
    where: { id: { in: serviceIds }, active: true, archivedAt: null },
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const items: ServiceView[] = []
  for (const id of serviceIds) {
    const row = byId.get(id)
    if (!row) throw invalidServices('Um dos serviços não está disponível. Escolha outro e tente de novo.')
    items.push({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      priceCents: row.priceCents,
      durationMin: row.durationMin,
      rewardPoints: row.rewardPoints,
      clubOnly: row.clubOnly,
      active: row.active,
      displayOrder: row.displayOrder,
      archived: row.archivedAt !== null,
    })
  }

  const durationMin = items.reduce((sum, item) => sum + item.durationMin, 0)
  if (durationMin > MAX_TOTAL_MIN) {
    throw invalidServices(`Os serviços somam mais de ${MAX_TOTAL_MIN / 60} horas. Escolha menos serviços.`)
  }

  if (ctx.actor.kind === 'customer' && items.some((item) => item.clubOnly)) {
    const customer = await ctx.db.customer.findUnique({
      where: { id: ctx.actor.customerId },
      select: { isClubMember: true },
    })
    if (!customer?.isClubMember) {
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
  ignoreAppointmentId: z.uuid('Agendamento inválido.').optional(),
})

/**
 * Expediente, agendamentos ativos e bloqueios de cada profissional no dia local, com uma consulta por tabela.
 * Os agendamentos são carregados com margem de `bufferMin` para a folga funcionar na borda do dia.
 */
export async function loadDayOccupancy(
  ctx: TenantContext,
  q: { professionalIds: string[]; date: string; ignoreAppointmentId?: string },
): Promise<Map<string, DayOccupancy>> {
  const { professionalIds, date, ignoreAppointmentId } = parse(occupancySchema, q)
  const result = new Map<string, DayOccupancy>()
  for (const id of professionalIds) result.set(id, { workingRanges: [], busy: [], blocked: [] })
  if (professionalIds.length === 0) return result

  const { bufferMin } = await getSchedulingRules(ctx)
  const day = localDayRange(date, ctx.timeZone)
  const [hours, appointments, blocks] = await Promise.all([
    ctx.db.workingHours.findMany({
      where: { professionalId: { in: professionalIds }, weekday: weekdayOf(date) },
      orderBy: [{ startMin: 'asc' }, { id: 'asc' }],
    }),
    ctx.db.appointment.findMany({
      where: {
        professionalId: { in: professionalIds },
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { lt: addMinutes(day.end, bufferMin) },
        endsAt: { gt: addMinutes(day.start, -bufferMin) },
        ...(ignoreAppointmentId ? { id: { not: ignoreAppointmentId } } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    }),
    ctx.db.timeBlock.findMany({
      where: {
        professionalId: { in: professionalIds },
        startsAt: { lt: day.end },
        endsAt: { gt: day.start },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    }),
  ])

  for (const h of hours) result.get(h.professionalId)?.workingRanges.push({ startMin: h.startMin, endMin: h.endMin })
  for (const a of appointments) result.get(a.professionalId)?.busy.push({ start: a.startsAt, end: a.endsAt })
  for (const b of blocks) result.get(b.professionalId)?.blocked.push({ start: b.startsAt, end: b.endsAt })
  return result
}

const availabilitySchema = z.object({
  date: localDate,
  professionalId: z.string().nullish(),
})

function invalidProfessional(): DomainError {
  const message = 'Este profissional não faz todos os serviços escolhidos. Escolha outro ou deixe em "qualquer um".'
  return new DomainError('validation', message, { fields: { professionalId: message } })
}

/** Inícios livres no dia local para os serviços escolhidos; cada início traz os profissionais livres nele. */
export async function getAvailability(
  ctx: TenantContext,
  q: { date: string; serviceIds: string[]; professionalId?: string | null },
): Promise<AvailabilityView> {
  const { date, professionalId } = parse(availabilitySchema, { date: q.date, professionalId: q.professionalId })
  const { durationMin, totalCents } = await resolveServices(ctx, q.serviceIds)
  const view = (slots: SlotView[]): AvailabilityView => ({ date, durationMin, totalCents, slots })

  const candidates = await ctx.db.professional.findMany({
    where: {
      active: true,
      archivedAt: null,
      AND: q.serviceIds.map((serviceId) => ({ services: { some: { serviceId } } })),
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  let chosen = candidates.map((p) => p.id)
  if (professionalId) {
    if (!chosen.includes(professionalId)) throw invalidProfessional()
    chosen = [professionalId]
  }

  const rules = await getSchedulingRules(ctx)
  const now = ctx.clock()
  const today = todayIn(ctx.timeZone, now)
  if (chosen.length === 0 || compareLocalDates(date, today) < 0) return view([])
  if (await isClosedOn(ctx, date)) return view([])

  const customer = isCustomer(ctx)
  const notBefore = customer ? addMinutes(now, rules.minLeadMin) : now
  const notAfter = customer
    ? localDayRange(addDays(today, rules.maxAdvanceDays), ctx.timeZone).end
    : addMinutes(now, STAFF_WINDOW_DAYS * 24 * 60)

  const occupancy = await loadDayOccupancy(ctx, { professionalIds: chosen, date })
  const starts = new Map<number, { startsAt: Date; professionalIds: string[] }>()
  for (const id of chosen) {
    const o = occupancy.get(id)
    if (!o) continue
    const free = computeSlots({
      date,
      timeZone: ctx.timeZone,
      workingRanges: o.workingRanges,
      busy: o.busy,
      blocked: o.blocked,
      durationMin,
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

  return view(
    [...starts.values()]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((s) => ({ startsAt: s.startsAt, label: formatTime(s.startsAt, ctx.timeZone), professionalIds: s.professionalIds })),
  )
}
