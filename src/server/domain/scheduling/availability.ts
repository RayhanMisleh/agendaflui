import type { TenantContext } from '@/server/auth/actor'
import { DomainError, parse, z } from '@/server/domain/errors'
import { isCustomer } from '@/server/domain/input'
import { isClosedOn } from '@/server/domain/settings/closures'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { computeSlots, type Interval, type WorkingRange } from '@/server/domain/scheduling/slots'
import { toServiceView, type ServiceView } from '@/server/domain/catalog/services'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
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

  if (ctx.actor.kind === 'customer' && items.some((item) => item.clubOnly)) {
    const customer = await db.customer.findFirst({
      where: { id: ctx.actor.customerId, archivedAt: null, anonymizedAt: null },
      select: { isClubMember: true },
    })
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
  const result = new Map<string, DayOccupancy>()
  for (const id of professionalIds) result.set(id, { workingRanges: [], busy: [], blocked: [] })
  if (professionalIds.length === 0) return result

  const day = localDayRange(date, ctx.timeZone)
  const [hours, appointments, blocks] = await Promise.all([
    db.workingHours.findMany({
      where: { professionalId: { in: professionalIds }, weekday: weekdayOf(date) },
      orderBy: [{ startMin: 'asc' }, { id: 'asc' }],
    }),
    db.appointment.findMany({
      where: {
        professionalId: { in: professionalIds },
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { lt: addMinutes(day.end, bufferMin) },
        endsAt: { gt: addMinutes(day.start, -bufferMin) },
        ...(ignoreAppointmentId ? { id: { not: ignoreAppointmentId } } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    }),
    db.timeBlock.findMany({
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
  const message = 'Este profissional não está disponível para esses serviços.'
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

  const occupancy = await loadDayOccupancy(ctx, { professionalIds: chosen, date, bufferMin: rules.bufferMin })
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
