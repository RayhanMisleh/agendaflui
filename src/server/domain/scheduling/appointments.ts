import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type {
  Appointment,
  AppointmentItem,
  AppointmentStatus,
  Customer,
  PartyType,
  Prisma,
  Professional,
} from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { formatPhone } from '@/server/domain/customers/contact'
import { DomainError, parse, z } from '@/server/domain/errors'
import { enqueueAppointmentEvent } from '@/server/domain/notifications/outbox'
import { getSchedulingRules, type SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import {
  computeFreeStarts,
  listCandidates,
  loadDayOccupancy,
  resolveServices,
  type Candidate,
} from '@/server/domain/scheduling/availability'
import { overlaps } from '@/server/domain/scheduling/slots'
import { ACTIVE_STATUSES, canTransition } from '@/server/domain/scheduling/status'
import { ownProfessionalId } from '@/server/domain/team/professionals'
import {
  addMinutes,
  formatTime,
  fromEpochMs,
  localDayRange,
  localParts,
  minutesBetween,
  toIsoInstant,
} from '@/server/time'

export type AppointmentView = {
  id: string
  status: AppointmentStatus
  source: 'APP' | 'PANEL'
  startsAt: Date
  endsAt: Date
  /** Rótulos no fuso da conta. */
  local: { date: string; start: string; end: string }
  customer: { id: string; name: string; phoneLabel: string | null }
  professional: { id: string; name: string }
  items: { serviceId: string; name: string; priceCents: number; durationMin: number }[]
  totalCents: number
  totalDurationMin: number
  commissionCents: number | null
  notes: string | null
  canceledAt: Date | null
  cancelReason: string | null
  completedAt: Date | null
}

type Db = TenantClient | TenantTx
type Who = 'customer' | 'staff'
type Scope = { all: boolean; ownId: string | null }

type Row = Appointment & { items: AppointmentItem[]; customer: Customer; professional: Professional }

/** Limite do passado e do futuro que a equipe pode registrar. */
const STAFF_RANGE_DAYS = 366
const MAX_TOTAL_CENTS = 10_000_000
/** Muitos pedidos podem esperar a mesma trava; o tempo cobre a fila de um horário disputado. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 }
const EDITABLE: readonly AppointmentStatus[] = ['PENDING', 'CONFIRMED']

const idSchema = z.uuid()

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .transform((texto) => (texto === '' ? null : texto))

const startsAtSchema = z.date('Informe um horário válido.')

const bookSchema = z.object({
  customerId: z.uuid('Escolha um cliente válido.').optional(),
  professionalId: z.uuid('Escolha um profissional válido.').nullish(),
  startsAt: startsAtSchema,
  notes: optionalText(2000).nullable().optional(),
})

const rescheduleSchema = z.object({
  startsAt: startsAtSchema,
  professionalId: z.uuid('Escolha um profissional válido.').nullish(),
})

const cancelSchema = z.object({ reason: optionalText(300).nullable().optional() })

const adjustSchema = z.object({
  totalCents: z
    .number()
    .int('Informe o valor em centavos, sem fração.')
    .min(0, 'O valor não pode ser negativo.')
    .max(MAX_TOTAL_CENTS, 'O valor é alto demais.')
    .optional(),
  notes: optionalText(2000).nullable().optional(),
})

type ChangeEvent =
  | 'booked'
  | 'rescheduled'
  | 'canceled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'outcome_undone'
  | 'adjusted'

/**
 * Ponto único dos avisos de cada operação. Roda dentro da transação, depois da gravação, para o aviso
 * nascer junto com a mudança ou não nascer.
 */
async function afterChange(
  tx: TenantTx,
  ctx: TenantContext,
  event: ChangeEvent,
  appointment: Row,
  extra: Record<string, string | number | null> = {},
): Promise<void> {
  if (event === 'adjusted') return
  const previous = typeof extra.previousStartsAt === 'number' ? fromEpochMs(extra.previousStartsAt) : undefined
  await enqueueAppointmentEvent(tx, ctx, event, appointment, previous ? { previousStartsAt: previous } : {})
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Agendamento não encontrado.')
}

function forbidden(message = 'Você não tem permissão para fazer isso.'): DomainError {
  return new DomainError('forbidden', message)
}

function invalidTransition(message: string): DomainError {
  return new DomainError('conflict', message, { reason: 'invalid_transition' })
}

function actorKind(ctx: TenantContext): Who {
  if (ctx.actor.kind === 'customer') return 'customer'
  if (can(ctx.actor, 'view_own_agenda')) return 'staff'
  throw forbidden()
}

function party(ctx: TenantContext): { type: PartyType; id: string | null } {
  const actor = ctx.actor
  switch (actor.kind) {
    case 'member':
      return { type: 'MEMBER', id: actor.userId }
    case 'impersonator':
    case 'platform_admin':
      return { type: 'PLATFORM_ADMIN', id: actor.adminId }
    case 'customer':
      return { type: 'CUSTOMER', id: actor.customerId }
    case 'system':
      return { type: 'SYSTEM', id: null }
  }
}

/** A equipe com `view_all_agendas` age em qualquer agenda; sem ela, só na do profissional ligado ao acesso. */
async function staffScope(ctx: TenantContext, who: Who): Promise<Scope> {
  if (who === 'customer') return { all: false, ownId: null }
  if (can(ctx.actor, 'view_all_agendas')) return { all: true, ownId: null }
  return { all: false, ownId: await ownProfessionalId(ctx) }
}

function assertProfessionalAllowed(who: Who, scope: Scope, professionalId: string): void {
  if (who === 'staff' && !scope.all && scope.ownId !== professionalId) {
    throw forbidden('Você só pode agir na sua própria agenda.')
  }
}

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

function toView(ctx: TenantContext, row: Row): AppointmentView {
  const customerView = ctx.actor.kind === 'customer'
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    local: {
      date: localParts(row.startsAt, ctx.timeZone).date,
      start: formatTime(row.startsAt, ctx.timeZone),
      end: formatTime(row.endsAt, ctx.timeZone),
    },
    customer: {
      id: row.customer.id,
      name: row.customer.name,
      phoneLabel: row.customer.phone ? formatPhone(row.customer.phone) : null,
    },
    professional: { id: row.professional.id, name: row.professional.name },
    items: [...row.items]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((item) => ({
        serviceId: item.serviceId,
        name: item.name,
        priceCents: item.priceCents,
        durationMin: item.durationMin,
      })),
    totalCents: row.totalCents,
    totalDurationMin: row.totalDurationMin,
    commissionCents: customerView ? null : row.commissionCents,
    notes: customerView ? null : row.notes,
    canceledAt: row.canceledAt,
    cancelReason: row.cancelReason,
    completedAt: row.completedAt,
  }
}

/**
 * Agendamento com itens, cliente e profissional. As consultas vão em sequência: dentro de uma transação o
 * cliente do banco atende uma por vez, e o `include` do Prisma as dispararia em paralelo.
 */
async function loadRow(db: Db, id: string): Promise<Row | null> {
  if (!idSchema.safeParse(id).success) return null
  const appointment = await db.appointment.findUnique({ where: { id } })
  if (!appointment) return null
  const items = await db.appointmentItem.findMany({
    where: { appointmentId: id },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
  const customer = await db.customer.findUnique({ where: { id: appointment.customerId } })
  const professional = await db.professional.findUnique({ where: { id: appointment.professionalId } })
  if (!customer || !professional) return null
  return { ...appointment, items, customer, professional }
}

/** Lê o agendamento e confere o acesso do ator: cliente só o próprio (`not_found`), equipe conforme a agenda. */
async function loadForActor(ctx: TenantContext, db: Db, id: string, who: Who, scope: Scope): Promise<Row> {
  const row = await loadRow(db, id)
  if (!row) throw notFound()
  if (ctx.actor.kind === 'customer' && row.customerId !== ctx.actor.customerId) throw notFound()
  assertProfessionalAllowed(who, scope, row.professionalId)
  return row
}

async function reload(db: Db, id: string): Promise<Row> {
  const row = await loadRow(db, id)
  if (!row) throw notFound()
  return row
}

function windowLabel(min: number): string {
  return min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`
}

/** O cliente só cancela ou remarca até `customerChangeWindowMin` antes do início. */
function assertCustomerWindow(ctx: TenantContext, rules: SchedulingRules, startsAt: Date, verb: string): void {
  if (minutesBetween(ctx.clock(), startsAt) < rules.customerChangeWindowMin) {
    throw new DomainError(
      'conflict',
      `O prazo para ${verb} pelo app é de ${windowLabel(rules.customerChangeWindowMin)} antes do horário. Fale com o estabelecimento.`,
      { reason: 'too_late' },
    )
  }
}

function assertStaffStart(ctx: TenantContext, startsAt: Date): void {
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

function invalidProfessional(message = 'Este profissional não está disponível para esses serviços.'): DomainError {
  return new DomainError('validation', message, { fields: { professionalId: message } })
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
async function assertFreeForStaff(
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
function assertProfessionalUnchanged(row: Row, lockedIds: readonly string[]): void {
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
async function placeAppointment(ctx: TenantContext, tx: TenantTx, p: Place): Promise<string> {
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
 * A violação da restrição do banco vira `slot_taken`; a lista dos próximos horários é calculada fora da
 * transação, que a violação já abortou.
 */
async function lockedTransaction<T>(
  ctx: TenantContext,
  lockIds: string[],
  overlapInfo: () => { startsAt: Date; durationMin: number; professionalIds: string[]; ignoreAppointmentId?: string },
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(lockIds)].sort()
  try {
    return await ctx.db.$transaction(async (tx) => {
      for (const id of ordered) await tx.$lockKey('professional', id)
      return fn(tx)
    }, TX_OPTIONS)
  } catch (err) {
    if (isOverlapViolation(err)) throw await slotTaken(ctx, ctx.db, overlapInfo())
    throw err
  }
}

/** Candidatos que entram na trava de "qualquer um": para a equipe sem agenda geral, só o próprio. */
function restrictToScope(who: Who, scope: Scope, candidates: Candidate[]): Candidate[] {
  if (who === 'staff' && !scope.all) return candidates.filter((c) => c.id === scope.ownId)
  return candidates
}

function itemRows(ctx: TenantContext, appointmentId: string, items: Awaited<ReturnType<typeof resolveServices>>['items']) {
  return items.map((item, index) => ({
    businessId: ctx.businessId,
    appointmentId,
    serviceId: item.id,
    name: item.name,
    priceCents: item.priceCents,
    durationMin: item.durationMin,
    rewardPoints: item.rewardPoints,
    position: index + 1,
  }))
}

export async function bookAppointment(
  ctx: TenantContext,
  i: { customerId?: string; professionalId?: string | null; serviceIds: string[]; startsAt: Date; notes?: string | null },
): Promise<AppointmentView> {
  const input = parse(bookSchema, {
    customerId: i.customerId,
    professionalId: i.professionalId,
    startsAt: i.startsAt,
    notes: i.notes,
  })
  const who = actorKind(ctx)
  let customerId: string
  if (ctx.actor.kind === 'customer') {
    if (input.customerId !== undefined && input.customerId !== ctx.actor.customerId) {
      throw forbidden('Você só pode marcar horários para você mesmo.')
    }
    customerId = ctx.actor.customerId
  } else {
    if (input.customerId === undefined) {
      const message = 'Escolha o cliente do agendamento.'
      throw new DomainError('validation', message, { fields: { customerId: message } })
    }
    customerId = input.customerId
    assertStaffStart(ctx, input.startsAt)
  }
  const scope = await staffScope(ctx, who)
  const specificId = input.professionalId ?? null
  if (specificId) assertProfessionalAllowed(who, scope, specificId)

  // Leitura prévia, só para validar cedo e saber quem travar; a decisão é refeita dentro da transação.
  const pre = await resolveServices(ctx, i.serviceIds)
  const lockIds = specificId
    ? [specificId]
    : restrictToScope(who, scope, await listCandidates(ctx, i.serviceIds)).map((c) => c.id)
  if (lockIds.length === 0) {
    if (who === 'customer') {
      throw new DomainError('conflict', 'Nenhum profissional está disponível para esses serviços.', {
        reason: 'slot_unavailable',
      })
    }
    throw invalidProfessional('Nenhum profissional da sua agenda faz esses serviços.')
  }

  const startsAt = input.startsAt
  return lockedTransaction(
    ctx,
    lockIds,
    () => ({ startsAt, durationMin: pre.durationMin, professionalIds: lockIds }),
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, archivedAt: null, anonymizedAt: null },
        select: { id: true },
      })
      if (!customer) {
        if (who === 'customer') throw forbidden('Seu cadastro não está ativo. Fale com o estabelecimento.')
        const message = 'Este cliente não existe ou está arquivado. Escolha outro cliente.'
        throw new DomainError('validation', message, { fields: { customerId: message } })
      }
      const rules = await getSchedulingRules(ctx, tx)
      const services = await resolveServices(ctx, i.serviceIds, tx)
      const endsAt = addMinutes(startsAt, services.durationMin)
      const candidates = await listCandidates(ctx, services.items.map((s) => s.id), tx)
      const locked = new Set(lockIds)
      let eligible: Candidate[]
      if (specificId) {
        const found = candidates.find((c) => c.id === specificId)
        if (!found) throw invalidProfessional()
        eligible = [found]
      } else {
        eligible = restrictToScope(who, scope, candidates).filter((c) => locked.has(c.id))
      }
      const professionalId = await placeAppointment(ctx, tx, {
        who,
        eligible,
        specific: specificId !== null,
        startsAt,
        endsAt,
        durationMin: services.durationMin,
        rules,
      })

      const by = party(ctx)
      const created = await tx.appointment.create({
        data: {
          businessId: ctx.businessId,
          customerId,
          professionalId,
          startsAt,
          endsAt,
          status: who === 'customer' && !rules.autoConfirm ? 'PENDING' : 'CONFIRMED',
          source: who === 'customer' ? 'APP' : 'PANEL',
          totalCents: services.totalCents,
          totalDurationMin: services.durationMin,
          notes: input.notes ?? null,
          createdByType: by.type,
          createdById: by.id,
        },
      })
      await tx.appointmentItem.createMany({ data: itemRows(ctx, created.id, services.items) })
      await audit(
        ctx,
        {
          action: 'appointment.booked',
          targetType: 'Appointment',
          targetId: created.id,
          metadata: { professionalId, startsAt: toIsoInstant(startsAt), source: created.source, status: created.status },
        },
        tx,
      )
      const row = await reload(tx, created.id)
      await afterChange(tx, ctx, 'booked', row)
      return toView(ctx, row)
    },
  )
}

export async function rescheduleAppointment(
  ctx: TenantContext,
  id: string,
  i: { startsAt: Date; professionalId?: string | null; serviceIds?: string[] },
): Promise<AppointmentView> {
  const input = parse(rescheduleSchema, { startsAt: i.startsAt, professionalId: i.professionalId })
  const who = actorKind(ctx)
  if (who === 'staff') assertStaffStart(ctx, input.startsAt)
  const scope = await staffScope(ctx, who)
  const before = await loadForActor(ctx, ctx.db, id, who, scope)
  if (!EDITABLE.includes(before.status)) {
    throw invalidTransition('Só dá para remarcar agendamentos pendentes ou confirmados.')
  }

  const keepProfessional = input.professionalId === undefined
  const specificId = keepProfessional ? before.professionalId : input.professionalId
  if (specificId) assertProfessionalAllowed(who, scope, specificId)
  const changesServices = i.serviceIds !== undefined
  const pre = changesServices ? await resolveServices(ctx, i.serviceIds ?? []) : null
  const serviceIds = i.serviceIds ?? before.items.map((item) => item.serviceId)

  const anyIds = specificId
    ? []
    : restrictToScope(who, scope, await listCandidates(ctx, serviceIds)).map((c) => c.id)
  const lockIds = [before.professionalId, ...(specificId ? [specificId] : anyIds)]
  const durationHint = pre?.durationMin ?? before.totalDurationMin

  return lockedTransaction(
    ctx,
    lockIds,
    () => ({
      startsAt: input.startsAt,
      durationMin: durationHint,
      professionalIds: specificId ? [specificId] : anyIds,
      ignoreAppointmentId: id,
    }),
    async (tx) => {
      const row = await loadForActor(ctx, tx, id, who, scope)
      if (!EDITABLE.includes(row.status)) {
        throw invalidTransition('Só dá para remarcar agendamentos pendentes ou confirmados.')
      }
      assertProfessionalUnchanged(row, lockIds)
      const rules = await getSchedulingRules(ctx, tx)
      if (who === 'customer') assertCustomerWindow(ctx, rules, row.startsAt, 'remarcar')

      const services = changesServices ? await resolveServices(ctx, i.serviceIds ?? [], tx) : null
      const durationMin = services?.durationMin ?? row.totalDurationMin
      const endsAt = addMinutes(input.startsAt, durationMin)
      // O atalho vale só para a equipe: o cliente do app sempre confere se o profissional ainda atende.
      const needsCandidateCheck = who === 'customer' || services !== null || specificId !== row.professionalId
      let eligible: Candidate[]
      if (specificId) {
        if (needsCandidateCheck) {
          const found = (await listCandidates(ctx, services?.items.map((s) => s.id) ?? serviceIds, tx)).find(
            (c) => c.id === specificId,
          )
          if (!found) throw invalidProfessional()
          eligible = [found]
        } else {
          eligible = [{ id: specificId, displayOrder: 0 }]
        }
      } else {
        const locked = new Set(lockIds)
        const candidates = await listCandidates(ctx, services?.items.map((s) => s.id) ?? serviceIds, tx)
        eligible = restrictToScope(who, scope, candidates).filter((c) => locked.has(c.id))
      }
      const professionalId = await placeAppointment(ctx, tx, {
        who,
        eligible,
        specific: specificId !== null,
        startsAt: input.startsAt,
        endsAt,
        durationMin,
        rules,
        ignoreAppointmentId: id,
      })

      await tx.appointment.update({
        where: { id },
        data: {
          startsAt: input.startsAt,
          endsAt,
          professionalId,
          ...(services ? { totalCents: services.totalCents, totalDurationMin: services.durationMin } : {}),
        },
      })
      if (services) {
        await tx.appointmentItem.deleteMany({ where: { appointmentId: id } })
        await tx.appointmentItem.createMany({ data: itemRows(ctx, id, services.items) })
      }
      await audit(
        ctx,
        {
          action: 'appointment.rescheduled',
          targetType: 'Appointment',
          targetId: id,
          metadata: {
            from: toIsoInstant(row.startsAt),
            to: toIsoInstant(input.startsAt),
            professionalId,
            previousProfessionalId: row.professionalId,
            servicesChanged: services !== null,
          },
        },
        tx,
      )
      const updated = await reload(tx, id)
      await afterChange(tx, ctx, 'rescheduled', updated, { previousStartsAt: row.startsAt.getTime() })
      return toView(ctx, updated)
    },
  )
}

type StatusChange = {
  to: AppointmentStatus
  /** Situações de origem aceitas (além de `canTransition`). */
  from?: readonly AppointmentStatus[]
  action: string
  event: ChangeEvent
  invalid: string
  customerVerb?: string
  /** Campos extras a gravar; pode recusar a mudança. */
  prepare?: (tx: TenantTx, row: Row) => Promise<Prisma.AppointmentUncheckedUpdateInput>
  metadata?: (row: Row, extra: Prisma.AppointmentUncheckedUpdateInput) => Record<string, string | number | null>
}

async function changeStatus(ctx: TenantContext, id: string, spec: StatusChange): Promise<AppointmentView> {
  const who = actorKind(ctx)
  if (who === 'customer' && !spec.customerVerb) throw forbidden()
  const scope = await staffScope(ctx, who)
  const before = await loadForActor(ctx, ctx.db, id, who, scope)

  return lockedTransaction(
    ctx,
    [before.professionalId],
    () => ({ startsAt: before.startsAt, durationMin: before.totalDurationMin, professionalIds: [before.professionalId], ignoreAppointmentId: id }),
    async (tx) => {
      const row = await loadForActor(ctx, tx, id, who, scope)
      assertProfessionalUnchanged(row, [before.professionalId])
      if (!canTransition(row.status, spec.to) || (spec.from && !spec.from.includes(row.status))) {
        throw invalidTransition(spec.invalid)
      }
      if (who === 'customer') {
        assertCustomerWindow(ctx, await getSchedulingRules(ctx, tx), row.startsAt, spec.customerVerb ?? '')
      }
      const extra = spec.prepare ? await spec.prepare(tx, row) : {}
      await tx.appointment.update({ where: { id }, data: { status: spec.to, ...extra } })
      await audit(
        ctx,
        {
          action: spec.action,
          targetType: 'Appointment',
          targetId: id,
          metadata: { from: row.status, to: spec.to, ...(spec.metadata?.(row, extra) ?? {}) },
        },
        tx,
      )
      const updated = await reload(tx, id)
      await afterChange(tx, ctx, spec.event, updated, { from: row.status })
      return toView(ctx, updated)
    },
  )
}

export async function cancelAppointment(
  ctx: TenantContext,
  id: string,
  i: { reason?: string | null } = {},
): Promise<AppointmentView> {
  const { reason } = parse(cancelSchema, i)
  const by = party(ctx)
  return changeStatus(ctx, id, {
    to: 'CANCELED',
    action: 'appointment.canceled',
    event: 'canceled',
    invalid: 'Só dá para cancelar agendamentos pendentes ou confirmados.',
    customerVerb: 'cancelar',
    prepare: async () => ({
      canceledAt: ctx.clock(),
      canceledByType: by.type,
      canceledById: by.id,
      cancelReason: reason ?? null,
    }),
  })
}

export function confirmAppointment(ctx: TenantContext, id: string): Promise<AppointmentView> {
  return changeStatus(ctx, id, {
    to: 'CONFIRMED',
    from: ['PENDING'],
    action: 'appointment.confirmed',
    event: 'confirmed',
    invalid: 'Só dá para confirmar agendamentos pendentes.',
  })
}

function assertStarted(ctx: TenantContext, row: Row, what: string): void {
  if (ctx.clock().getTime() < row.startsAt.getTime()) {
    throw new DomainError('conflict', `Só dá para ${what} depois do horário de início do atendimento.`, {
      reason: 'too_early',
    })
  }
}

export function completeAppointment(ctx: TenantContext, id: string): Promise<AppointmentView> {
  return changeStatus(ctx, id, {
    to: 'COMPLETED',
    action: 'appointment.completed',
    event: 'completed',
    invalid: 'Só dá para concluir agendamentos confirmados.',
    prepare: async (_tx, row) => {
      assertStarted(ctx, row, 'concluir o atendimento')
      const bps = row.professional.commissionBps
      return { completedAt: ctx.clock(), commissionCents: Math.round((row.totalCents * bps) / 10_000) }
    },
    metadata: (_row, extra) => ({ commissionCents: typeof extra.commissionCents === 'number' ? extra.commissionCents : null }),
  })
}

export function markNoShow(ctx: TenantContext, id: string): Promise<AppointmentView> {
  return changeStatus(ctx, id, {
    to: 'NO_SHOW',
    action: 'appointment.no_show',
    event: 'no_show',
    invalid: 'Só dá para marcar falta em agendamentos confirmados.',
    prepare: async (_tx, row) => {
      assertStarted(ctx, row, 'marcar a falta')
      return {}
    },
  })
}

export function undoOutcome(ctx: TenantContext, id: string): Promise<AppointmentView> {
  return changeStatus(ctx, id, {
    to: 'CONFIRMED',
    from: ['COMPLETED', 'NO_SHOW'],
    action: 'appointment.outcome_undone',
    event: 'outcome_undone',
    invalid: 'Só dá para desfazer agendamentos concluídos ou com falta.',
    prepare: async () => ({ completedAt: null, commissionCents: null }),
  })
}

export async function adjustAppointment(
  ctx: TenantContext,
  id: string,
  i: { serviceIds?: string[]; totalCents?: number; notes?: string | null },
): Promise<AppointmentView> {
  const who = actorKind(ctx)
  if (who === 'customer') throw forbidden()
  const input = parse(adjustSchema, { totalCents: i.totalCents, notes: i.notes })
  const scope = await staffScope(ctx, who)
  const before = await loadForActor(ctx, ctx.db, id, who, scope)
  if (!EDITABLE.includes(before.status)) {
    throw invalidTransition('Só dá para ajustar agendamentos pendentes ou confirmados.')
  }
  const pre = i.serviceIds !== undefined ? await resolveServices(ctx, i.serviceIds) : null

  return lockedTransaction(
    ctx,
    [before.professionalId],
    () => ({
      startsAt: before.startsAt,
      durationMin: pre?.durationMin ?? before.totalDurationMin,
      professionalIds: [before.professionalId],
      ignoreAppointmentId: id,
    }),
    async (tx) => {
      const row = await loadForActor(ctx, tx, id, who, scope)
      assertProfessionalUnchanged(row, [before.professionalId])
      if (!EDITABLE.includes(row.status)) {
        throw invalidTransition('Só dá para ajustar agendamentos pendentes ou confirmados.')
      }
      const data: Prisma.AppointmentUncheckedUpdateInput = {}
      const fields: string[] = []
      const services = i.serviceIds !== undefined ? await resolveServices(ctx, i.serviceIds, tx) : null
      if (services) {
        const candidates = await listCandidates(ctx, services.items.map((s) => s.id), tx)
        if (!candidates.some((c) => c.id === row.professionalId)) {
          const message = 'Este profissional não faz algum dos serviços escolhidos.'
          throw new DomainError('validation', message, { fields: { serviceIds: message } })
        }
        const endsAt = addMinutes(row.startsAt, services.durationMin)
        const rules = await getSchedulingRules(ctx, tx)
        await assertFreeForStaff(ctx, tx, {
          professionalIds: [row.professionalId],
          specific: true,
          startsAt: row.startsAt,
          endsAt,
          durationMin: services.durationMin,
          bufferMin: rules.bufferMin,
          ignoreAppointmentId: id,
        })
        data.endsAt = endsAt
        data.totalCents = services.totalCents
        data.totalDurationMin = services.durationMin
        fields.push('serviceIds')
      }
      if (input.totalCents !== undefined) {
        data.totalCents = input.totalCents
        fields.push('totalCents')
      }
      if (input.notes !== undefined) {
        data.notes = input.notes
        fields.push('notes')
      }
      if (fields.length === 0) return toView(ctx, row)

      await tx.appointment.update({ where: { id }, data })
      if (services) {
        await tx.appointmentItem.deleteMany({ where: { appointmentId: id } })
        await tx.appointmentItem.createMany({ data: itemRows(ctx, id, services.items) })
      }
      await audit(
        ctx,
        { action: 'appointment.adjusted', targetType: 'Appointment', targetId: id, metadata: { fields } },
        tx,
      )
      const updated = await reload(tx, id)
      await afterChange(tx, ctx, 'adjusted', updated, { fields: fields.join(',') })
      return toView(ctx, updated)
    },
  )
}

export async function getAppointment(ctx: TenantContext, id: string): Promise<AppointmentView> {
  const who = actorKind(ctx)
  const scope = await staffScope(ctx, who)
  return toView(ctx, await loadForActor(ctx, ctx.db, id, who, scope))
}
