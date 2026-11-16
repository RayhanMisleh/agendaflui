import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { AppointmentStatus, Prisma, Professional } from '@/server/db/generated/client'
import { authorize, DomainError, parse, z } from '@/server/domain/errors'
import { listClosures } from '@/server/domain/settings/closures'
import {
  actorKind,
  assertProfessionalAllowed,
  forbidden,
  staffScope,
  toView,
  type AppointmentView,
  type Row,
  type Scope,
  type Who,
} from '@/server/domain/scheduling/appointment-view'
import type { TimeBlockView } from '@/server/domain/team/time-blocks'
import {
  addDays,
  compareLocalDates,
  daysBetween,
  formatTime,
  fromEpochMs,
  isLocalDate,
  localDayRange,
  localParts,
  minuteLabel,
  weekdayOf,
  type Weekday,
} from '@/server/time'

export type AgendaDay = {
  date: string
  weekday: Weekday
  closed: boolean
  closureReason: string | null
  professionals: {
    id: string
    name: string
    workingRanges: { startMin: number; endMin: number; startLabel: string; endLabel: string }[]
    appointments: AppointmentView[]
    blocks: (TimeBlockView & { local: { start: string; end: string } })[]
  }[]
}

export type DaySummary = {
  total: number
  byStatus: Record<AppointmentStatus, number>
  bookedMinutes: number
  workingMinutes: number
  revenueCents: number
}

const MAX_DAYS = 31
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const UPCOMING: AppointmentStatus[] = ['PENDING', 'CONFIRMED']
const BOOKED: readonly AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED']

const localDate = z.string().refine(isLocalDate, 'Use uma data válida no formato AAAA-MM-DD.')
const idSchema = z.uuid()

const agendaSchema = z.object({
  from: localDate,
  to: localDate,
  professionalId: z.string().nullable().optional(),
  includeCanceled: z.boolean().optional(),
})

const listSchema = z.object({
  customerId: z.string().optional(),
  scope: z.enum(['upcoming', 'past']),
  cursor: z.string().optional(),
  limit: z
    .number()
    .int('Use um número inteiro.')
    .min(1, 'Use pelo menos 1 item.')
    .max(MAX_LIMIT, `Use no máximo ${MAX_LIMIT} itens por página.`)
    .optional(),
})

const summarySchema = z.object({ date: localDate, professionalId: z.string().nullable().optional() })

const include = { items: true, customer: true, professional: true } satisfies Prisma.AppointmentInclude

function professionalNotFound(): DomainError {
  return new DomainError('not_found', 'Profissional não encontrado.')
}

function byProfessional(a: Professional, b: Professional): number {
  return a.displayOrder - b.displayOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

/**
 * Profissionais cuja agenda o ator pode ver: o pedido (ou todos os ativos) com `view_all_agendas`; só a própria
 * ficha sem ela. `null` no pedido e `undefined` valem como "não pediu".
 */
async function visibleProfessionals(
  ctx: TenantContext,
  who: Who,
  scope: Scope,
  requested: string | null | undefined,
): Promise<Professional[]> {
  const id = requested ?? null
  if (id !== null) {
    if (!idSchema.safeParse(id).success) throw professionalNotFound()
    assertProfessionalAllowed(who, scope, id)
    const found = await ctx.db.professional.findUnique({ where: { id } })
    if (!found) throw professionalNotFound()
    return [found]
  }
  if (!scope.all) {
    if (!scope.ownId) return []
    const own = await ctx.db.professional.findUnique({ where: { id: scope.ownId } })
    return own ? [own] : []
  }
  const rows = await ctx.db.professional.findMany({ where: { active: true, archivedAt: null } })
  return rows.sort(byProfessional)
}

type Ranges = { startMin: number; endMin: number }[]

/** Expediente por profissional e dia da semana, numa só consulta. */
async function loadWorkingHours(
  ctx: TenantContext,
  professionalIds: string[],
): Promise<Map<string, Map<Weekday, Ranges>>> {
  const rows = await ctx.db.workingHours.findMany({
    where: { professionalId: { in: professionalIds } },
    orderBy: [{ startMin: 'asc' }, { endMin: 'asc' }, { id: 'asc' }],
  })
  const result = new Map<string, Map<Weekday, Ranges>>()
  for (const row of rows) {
    const days = result.get(row.professionalId) ?? new Map<Weekday, Ranges>()
    const ranges = days.get(row.weekday) ?? []
    ranges.push({ startMin: row.startMin, endMin: row.endMin })
    days.set(row.weekday, ranges)
    result.set(row.professionalId, days)
  }
  return result
}

export async function getAgenda(
  ctx: TenantContext,
  q: { from: string; to: string; professionalId?: string | null; includeCanceled?: boolean },
): Promise<AgendaDay[]> {
  const { from, to, professionalId, includeCanceled } = parse(agendaSchema, q)
  const who = actorKind(ctx)
  if (who === 'customer') throw forbidden('Você não tem permissão para ver a agenda.')
  if (compareLocalDates(from, to) > 0) {
    throw new DomainError('validation', 'A data final deve ser igual ou depois da inicial.', {
      fields: { to: 'Use uma data igual ou depois da inicial.' },
    })
  }
  if (daysBetween(from, to) + 1 > MAX_DAYS) {
    throw new DomainError('validation', `Consulte no máximo ${MAX_DAYS} dias por vez.`, {
      fields: { to: `O intervalo pode ter até ${MAX_DAYS} dias.` },
    })
  }
  const scope = await staffScope(ctx, who)
  const professionals = await visibleProfessionals(ctx, who, scope, professionalId)
  const ids = professionals.map((p) => p.id)

  const dates: string[] = []
  for (let date = from; compareLocalDates(date, to) <= 0; date = addDays(date, 1)) dates.push(date)
  const start = localDayRange(from, ctx.timeZone).start
  const end = localDayRange(to, ctx.timeZone).end

  const closures = await listClosures(ctx, { from, to })
  const hours = ids.length > 0 ? await loadWorkingHours(ctx, ids) : new Map<string, Map<Weekday, Ranges>>()
  const rows: Row[] =
    ids.length > 0
      ? await ctx.db.appointment.findMany({
          where: {
            professionalId: { in: ids },
            startsAt: { gte: start, lt: end },
            ...(includeCanceled ? {} : { status: { not: 'CANCELED' } }),
          },
          include,
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        })
      : []
  const blocks =
    ids.length > 0
      ? await ctx.db.timeBlock.findMany({
          where: { professionalId: { in: ids }, startsAt: { lt: end }, endsAt: { gt: start } },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        })
      : []

  const byDay = new Map<string, Map<string, AppointmentView[]>>()
  for (const row of rows) {
    const date = localParts(row.startsAt, ctx.timeZone).date
    const columns = byDay.get(date) ?? new Map<string, AppointmentView[]>()
    const list = columns.get(row.professionalId) ?? []
    list.push(toView(ctx, row))
    columns.set(row.professionalId, list)
    byDay.set(date, columns)
  }

  const seesAllReasons = can(ctx.actor, 'view_all_agendas')
  return dates.map((date) => {
    const range = localDayRange(date, ctx.timeZone)
    const weekday = weekdayOf(date)
    const closure = closures.find((c) => compareLocalDates(c.startDate, date) <= 0 && compareLocalDates(c.endDate, date) >= 0)
    return {
      date,
      weekday,
      closed: closure !== undefined,
      closureReason: closure?.reason ?? null,
      professionals: professionals.map((p) => {
        const seesReason = seesAllReasons || scope.ownId === p.id
        return {
          id: p.id,
          name: p.name,
          workingRanges: (hours.get(p.id)?.get(weekday) ?? []).map((r) => ({
            ...r,
            startLabel: minuteLabel(r.startMin),
            endLabel: minuteLabel(r.endMin),
          })),
          appointments: byDay.get(date)?.get(p.id) ?? [],
          blocks: blocks
            .filter((b) => b.professionalId === p.id && b.startsAt < range.end && b.endsAt > range.start)
            .map((b) => ({
              id: b.id,
              professionalId: b.professionalId,
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              reason: seesReason ? b.reason : null,
              local: {
                start: b.startsAt <= range.start ? '00:00' : formatTime(b.startsAt, ctx.timeZone),
                end: b.endsAt >= range.end ? '24:00' : formatTime(b.endsAt, ctx.timeZone),
              },
            })),
        }
      }),
    }
  })
}

/** Cliente cujos agendamentos a chamada lê: o do app só o próprio; a equipe, qualquer um da conta. */
async function resolveCustomer(ctx: TenantContext, customerId: string | undefined): Promise<string> {
  if (ctx.actor.kind === 'customer') {
    if (customerId !== undefined && customerId !== ctx.actor.customerId) {
      throw forbidden('Você só pode ver os seus agendamentos.')
    }
    return ctx.actor.customerId
  }
  authorize(ctx, 'view_clients')
  if (customerId === undefined) {
    throw new DomainError('validation', 'Informe o cliente.', { fields: { customerId: 'Informe o cliente.' } })
  }
  const found = idSchema.safeParse(customerId).success
    ? await ctx.db.customer.findUnique({ where: { id: customerId }, select: { id: true } })
    : null
  if (!found) throw new DomainError('not_found', 'Cliente não encontrado.')
  return found.id
}

type Cursor = { startsAt: Date; id: string }

function encodeCursor(row: { startsAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.startsAt.getTime(), row.id])).toString('base64url')
}

function decodeCursor(cursor: string): Cursor {
  const invalid = new DomainError('validation', 'O cursor de paginação é inválido. Recarregue a lista.', {
    fields: { cursor: 'Cursor inválido.' },
  })
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'number' &&
      Number.isSafeInteger(parsed[0]) &&
      typeof parsed[1] === 'string' &&
      idSchema.safeParse(parsed[1]).success
    ) {
      return { startsAt: fromEpochMs(parsed[0]), id: parsed[1] }
    }
  } catch {
    // cai no erro abaixo
  }
  throw invalid
}

export async function listCustomerAppointments(
  ctx: TenantContext,
  q: { customerId?: string; scope: 'upcoming' | 'past'; cursor?: string; limit?: number },
): Promise<{ items: AppointmentView[]; nextCursor: string | null }> {
  const { customerId: asked, scope, cursor, limit = DEFAULT_LIMIT } = parse(listSchema, q)
  const customerId = await resolveCustomer(ctx, asked)
  const after = cursor === undefined ? null : decodeCursor(cursor)
  const now = ctx.clock()
  const upcoming = scope === 'upcoming'
  const conditions: Prisma.AppointmentWhereInput[] = [
    { customerId },
    upcoming
      ? { startsAt: { gte: now }, status: { in: UPCOMING } }
      : { OR: [{ startsAt: { lt: now } }, { status: { notIn: UPCOMING } }] },
  ]
  if (after) {
    const op = upcoming ? 'gt' : 'lt'
    conditions.push({
      OR: [{ startsAt: { [op]: after.startsAt } }, { startsAt: after.startsAt, id: { [op]: after.id } }],
    })
  }
  const direction = upcoming ? 'asc' : 'desc'
  const rows: Row[] = await ctx.db.appointment.findMany({
    where: { AND: conditions },
    include,
    orderBy: [{ startsAt: direction }, { id: direction }],
    take: limit + 1,
  })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map((row) => toView(ctx, row)),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  }
}

export async function getNextAppointment(ctx: TenantContext, customerId?: string): Promise<AppointmentView | null> {
  const id = await resolveCustomer(ctx, customerId)
  const row: Row | null = await ctx.db.appointment.findFirst({
    where: { customerId: id, startsAt: { gte: ctx.clock() }, status: { in: UPCOMING } },
    include,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  return row ? toView(ctx, row) : null
}

function emptySummary(): DaySummary {
  return {
    total: 0,
    byStatus: { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, NO_SHOW: 0 },
    bookedMinutes: 0,
    workingMinutes: 0,
    revenueCents: 0,
  }
}

export async function getDaySummary(
  ctx: TenantContext,
  date: string,
  professionalId?: string | null,
): Promise<DaySummary> {
  const parsed = parse(summarySchema, { date, professionalId })
  const who = actorKind(ctx)
  if (who === 'customer') throw forbidden('Você não tem permissão para ver o resumo do dia.')
  const scope = await staffScope(ctx, who)
  const professionals = await visibleProfessionals(ctx, who, scope, parsed.professionalId)
  const summary = emptySummary()
  // Quem vê todas as agendas e não filtrou conta todos os agendamentos do dia, mesmo os de fichas arquivadas.
  const everyone = scope.all && (parsed.professionalId ?? null) === null
  if (!everyone && professionals.length === 0) return summary

  const range = localDayRange(parsed.date, ctx.timeZone)
  const rows = await ctx.db.appointment.findMany({
    where: {
      startsAt: { gte: range.start, lt: range.end },
      ...(everyone ? {} : { professionalId: { in: professionals.map((p) => p.id) } }),
    },
    select: { status: true, totalCents: true, totalDurationMin: true },
  })
  for (const row of rows) {
    summary.total += 1
    summary.byStatus[row.status] += 1
    if (BOOKED.includes(row.status)) summary.bookedMinutes += row.totalDurationMin
    if (row.status === 'COMPLETED') summary.revenueCents += row.totalCents
  }

  const closures = await listClosures(ctx, { from: parsed.date, to: parsed.date })
  if (closures.length === 0 && professionals.length > 0) {
    const hours = await loadWorkingHours(
      ctx,
      professionals.map((p) => p.id),
    )
    const weekday = weekdayOf(parsed.date)
    for (const days of hours.values()) {
      for (const r of days.get(weekday) ?? []) summary.workingMinutes += r.endMin - r.startMin
    }
  }
  return summary
}
