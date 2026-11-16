import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import { getSchedulingRules, type SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { computeFreeStarts, loadDayOccupancy, type Candidate } from '@/server/domain/scheduling/availability'
import type { Db, Row, Who } from '@/server/domain/scheduling/appointment-view'
import { overlaps } from '@/server/domain/scheduling/slots'
import { ACTIVE_STATUSES } from '@/server/domain/scheduling/status'
import { addMinutes, formatTime, localDayRange, localParts, minutesBetween } from '@/server/time'

/** Limite do passado e do futuro que a equipe pode registrar. */
export const STAFF_RANGE_DAYS = 366

/** Muitos pedidos podem esperar a mesma trava; o tempo cobre a fila de um horário disputado. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 }

/** Prefere o campo `constraint` do erro do Postgres; o texto da mensagem fica como alternativa. */
function namesOverlapConstraint(cause: object): boolean {
  if ('constraint' in cause && typeof cause.constraint === 'string') {
    return cause.constraint === 'appointments_no_overlap'
  }
  return 'message' in cause && typeof cause.message === 'string' && cause.message.includes('appointments_no_overlap')
}

function isOverlapViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== 'P2039') return false
  const meta = 'meta' in err ? err.meta : undefined
  if (typeof meta !== 'object' || meta === null || !('driverAdapterError' in meta)) return false
  const adapter = meta.driverAdapterError
  if (typeof adapter !== 'object' || adapter === null || !('cause' in adapter)) return false
  const cause = adapter.cause
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === '23P01' &&
    namesOverlapConstraint(cause)
  )
}

function windowLabel(min: number): string {
  return min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`
}

/** O cliente só cancela ou remarca até `customerChangeWindowMin` antes do início. */
export function assertCustomerWindow(ctx: TenantContext, rules: SchedulingRules, startsAt: Date, verb: string): void {
  if (minutesBetween(ctx.clock(), startsAt) < rules.customerChangeWindowMin) {
    throw new DomainError(
      'conflict',
      `O prazo para ${verb} pelo app é de ${windowLabel(rules.customerChangeWindowMin)} antes do horário. Fale com o estabelecimento.`,
      { reason: 'too_late' },
    )
  }
}

export function assertStaffStart(ctx: TenantContext, startsAt: Date): void {
  const fail = (message: string): never => {
    throw new DomainError('validation', message, { fields: { startsAt: message } })
  }
  if (startsAt.getTime() % 60_000 !== 0) fail('O horário deve ter minutos inteiros, sem segundos.')
  const limit = STAFF_RANGE_DAYS * 24 * 60
  const now = ctx.clock()
  if (startsAt.getTime() < addMinutes(now, -limit).getTime()) {
    fail(`Não dá para registrar um horário de mais de ${STAFF_RANGE_DAYS} dias atrás.`)
  }
  if (startsAt.getTime() > addMinutes(now, limit).getTime()) {
    fail(`Não dá para marcar um horário a mais de ${STAFF_RANGE_DAYS} dias.`)
  }
}

type Conflict = 'busy' | 'blocked' | null

/** Sobreposição bruta (sem folga) de cada profissional com o intervalo; considera os dois dias se cruzar a meia-noite. */
async function conflictsOf(
  ctx: TenantContext,
  db: Db,
  i: { professionalIds: string[]; startsAt: Date; endsAt: Date; bufferMin: number; ignoreAppointmentId?: string },
): Promise<Map<string, Conflict>> {
  const interval = { start: i.startsAt, end: i.endsAt }
  const dates = [
    ...new Set([localParts(i.startsAt, ctx.timeZone).date, localParts(addMinutes(i.endsAt, -1), ctx.timeZone).date]),
  ]
  const result = new Map<string, Conflict>(i.professionalIds.map((id) => [id, null]))
  for (const date of dates) {
    const occupancy = await loadDayOccupancy(
      ctx,
      {
        professionalIds: i.professionalIds,
        date,
        bufferMin: i.bufferMin,
        ...(i.ignoreAppointmentId ? { ignoreAppointmentId: i.ignoreAppointmentId } : {}),
      },
      db,
    )
    for (const [id, o] of occupancy) {
      if (o.busy.some((b) => overlaps(interval, b))) result.set(id, 'busy')
      else if (result.get(id) === null && o.blocked.some((b) => overlaps(interval, b))) result.set(id, 'blocked')
    }
  }
  return result
}

/** Erro de horário ocupado, com até 3 próximos inícios livres do mesmo dia (melhor esforço). */
async function slotTaken(
  ctx: TenantContext,
  db: Db,
  i: { startsAt: Date; durationMin: number; professionalIds: string[]; ignoreAppointmentId?: string },
): Promise<DomainError> {
  // `nearest` usa as regras do cliente (grade e folga) também quando quem pede é a equipe.
  let nearest: { startsAt: Date; label: string }[] = []
  try {
    const rules = await getSchedulingRules(ctx, db)
    const starts = await computeFreeStarts(
      ctx,
      {
        date: localParts(i.startsAt, ctx.timeZone).date,
        durationMin: i.durationMin,
        professionalIds: i.professionalIds,
        rules,
        ...(i.ignoreAppointmentId ? { ignoreAppointmentId: i.ignoreAppointmentId } : {}),
      },
      db,
    )
    nearest = [...starts.values()]
      .filter((s) => s.startsAt.getTime() > i.startsAt.getTime())
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, 3)
      .map((s) => ({ startsAt: s.startsAt, label: formatTime(s.startsAt, ctx.timeZone) }))
  } catch {
    nearest = []
  }
  return new DomainError('conflict', 'Esse horário acabou de ser ocupado. Escolha outro.', {
    reason: 'slot_taken',
    details: { nearest },
  })
}

/** Equipe: devolve os profissionais livres no intervalo (sem folga). Nenhum livre vira `blocked` ou `slot_taken`. */
export async function assertFreeForStaff(
  ctx: TenantContext,
  tx: TenantTx,
  i: {
    professionalIds: string[]
    specific: boolean
    startsAt: Date
    endsAt: Date
    durationMin: number
    bufferMin: number
    ignoreAppointmentId?: string
  },
): Promise<string[]> {
  const ignore = i.ignoreAppointmentId ? { ignoreAppointmentId: i.ignoreAppointmentId } : {}
  const states = await conflictsOf(ctx, tx, {
    professionalIds: i.professionalIds,
    startsAt: i.startsAt,
    endsAt: i.endsAt,
    bufferMin: i.bufferMin,
    ...ignore,
  })
  const free = i.professionalIds.filter((id) => states.get(id) === null)
  if (free.length > 0) return free
  const only = i.professionalIds.length === 1 ? states.get(i.professionalIds[0] ?? '') : undefined
  if (i.specific && only === 'blocked') {
    throw new DomainError(
      'conflict',
      'A agenda deste profissional está bloqueada nesse horário. Escolha outro horário ou outro profissional.',
      { reason: 'blocked' },
    )
  }
  throw await slotTaken(ctx, tx, {
    startsAt: i.startsAt,
    durationMin: i.durationMin,
    professionalIds: i.professionalIds,
    ...ignore,
  })
}

/** O agendamento relido sob a trava ainda é do profissional que foi travado; senão ele mudou nesse meio-tempo. */
export function assertProfessionalUnchanged(row: Row, lockedIds: readonly string[]): void {
  if (!lockedIds.includes(row.professionalId)) {
    throw new DomainError('conflict', 'Este agendamento mudou enquanto você o editava. Abra-o de novo.', {
      reason: 'changed',
    })
  }
}

type Place = {
  who: Who
  eligible: Candidate[]
  specific: boolean
  startsAt: Date
  endsAt: Date
  durationMin: number
  rules: SchedulingRules
  ignoreAppointmentId?: string
}

/**
 * Decide, dentro da transação e com as travas já obtidas, em qual profissional o atendimento cabe.
 * Cliente do app: o início precisa estar entre os oferecidos por `getAvailability` (mesma conta).
 * Equipe: só não pode sobrepor outro agendamento ativo nem bloqueio do profissional.
 */
export async function placeAppointment(ctx: TenantContext, tx: TenantTx, p: Place): Promise<string> {
  const ids = p.eligible.map((c) => c.id)
  const ignore = p.ignoreAppointmentId ? { ignoreAppointmentId: p.ignoreAppointmentId } : {}
  const taken = () => slotTaken(ctx, tx, { startsAt: p.startsAt, durationMin: p.durationMin, professionalIds: ids, ...ignore })
  const conflicts = () =>
    conflictsOf(ctx, tx, { professionalIds: ids, startsAt: p.startsAt, endsAt: p.endsAt, bufferMin: p.rules.bufferMin, ...ignore })

  let free: string[]
  if (p.who === 'customer') {
    const starts = await computeFreeStarts(
      ctx,
      {
        date: localParts(p.startsAt, ctx.timeZone).date,
        durationMin: p.durationMin,
        professionalIds: ids,
        rules: p.rules,
        ...ignore,
      },
      tx,
    )
    free = starts.get(p.startsAt.getTime())?.professionalIds ?? []
    if (free.length === 0) {
      if ([...(await conflicts()).values()].some((c) => c === 'busy')) throw await taken()
      throw new DomainError('conflict', 'Esse horário não está disponível. Escolha um dos horários oferecidos.', {
        reason: 'slot_unavailable',
      })
    }
  } else {
    free = await assertFreeForStaff(ctx, tx, {
      professionalIds: ids,
      specific: p.specific,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      durationMin: p.durationMin,
      bufferMin: p.rules.bufferMin,
      ...ignore,
    })
  }

  const [first] = free
  if (free.length === 1 && first) return first
  const day = localDayRange(localParts(p.startsAt, ctx.timeZone).date, ctx.timeZone)
  const booked = await tx.appointment.findMany({
    where: {
      professionalId: { in: free },
      status: { in: [...ACTIVE_STATUSES] },
      startsAt: { gte: day.start, lt: day.end },
      ...(p.ignoreAppointmentId ? { id: { not: p.ignoreAppointmentId } } : {}),
    },
    select: { professionalId: true },
  })
  const load = new Map<string, number>(free.map((id) => [id, 0]))
  for (const b of booked) load.set(b.professionalId, (load.get(b.professionalId) ?? 0) + 1)
  const order = new Map(p.eligible.map((c) => [c.id, c.displayOrder]))
  const best = [...free].sort(
    (a, b) =>
      (load.get(a) ?? 0) - (load.get(b) ?? 0) ||
      (order.get(a) ?? 0) - (order.get(b) ?? 0) ||
      a.localeCompare(b),
  )[0]
  if (!best) throw await taken()
  return best
}

/**
 * Transação com trava por profissional (em ordem crescente de id, para não travar em deadlock).
 * Com `customerId`, a trava do cliente vem antes de todas (marcar, arquivar e anonimizar o mesmo cliente
 * se serializam; a ordem é sempre cliente, depois profissionais).
 * A violação da restrição do banco vira `slot_taken`; a lista dos próximos horários é calculada fora da
 * transação, que a violação já abortou.
 */
export async function lockedTransaction<T>(
  ctx: TenantContext,
  lockIds: string[],
  overlapInfo: () => { startsAt: Date; durationMin: number; professionalIds: string[]; ignoreAppointmentId?: string },
  fn: (tx: TenantTx) => Promise<T>,
  opts: { customerId?: string } = {},
): Promise<T> {
  const ordered = [...new Set(lockIds)].sort()
  try {
    return await ctx.db.$transaction(async (tx) => {
      if (opts.customerId) await tx.$lockKey('customer', opts.customerId)
      for (const id of ordered) await tx.$lockKey('professional', id)
      return fn(tx)
    }, TX_OPTIONS)
  } catch (err) {
    if (isOverlapViolation(err)) throw await slotTaken(ctx, ctx.db, overlapInfo())
    throw err
  }
}
