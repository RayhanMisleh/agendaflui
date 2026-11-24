import { createHash } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { Prisma, PriceVariant } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { DomainError, parse, z } from '@/server/domain/errors'
import { loadPetForBooking } from '@/server/domain/pets/pets'
import { variantOfPet } from '@/server/niches'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import {
  listCandidates,
  resolveServices,
  type Candidate,
} from '@/server/domain/scheduling/availability'
import {
  actorKind,
  afterChange,
  assertProfessionalAllowed,
  forbidden,
  invalidTransition,
  loadForActor,
  optionalText,
  party,
  reload,
  staffScope,
  toView,
  type AppointmentView,
  type Db,
  type Scope,
  type Who,
} from '@/server/domain/scheduling/appointment-view'
import {
  assertCustomerWindow,
  assertProfessionalUnchanged,
  assertStaffStart,
  confirmStaffIssues,
  lockedTransaction,
  placeAppointment,
} from '@/server/domain/scheduling/placement'
import { overlapsNormal } from '@/server/domain/scheduling/squeeze-in'
import { staffIssues } from '@/server/domain/scheduling/staff-issues'
import { OPEN_STATUSES } from '@/server/domain/scheduling/status'
import { addMinutes, minutesBetween, toIsoInstant } from '@/server/time'

export {
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  markNoShow,
  undoOutcome,
} from '@/server/domain/scheduling/appointment-status-ops'
export type { AppointmentView } from '@/server/domain/scheduling/appointment-view'

const MAX_TOTAL_CENTS = 10_000_000

/** Por quanto tempo uma chave de idempotência vale: passado esse prazo, a mesma chave marca de novo. */
export const IDEMPOTENCY_TTL_MIN = 24 * 60

const startsAtSchema = z.date('Informe um horário válido.')

const DURATION_MESSAGE = 'Use de 5 a 720 minutos.'
/** Duração livre da equipe: minutos inteiros de 5 a 720. */
const durationSchema = z.number(DURATION_MESSAGE).int(DURATION_MESSAGE).min(5, DURATION_MESSAGE).max(720, DURATION_MESSAGE)

const CUSTOMER_DURATION_MESSAGE = 'A duração é definida pelos serviços.'

const bookSchema = z.object({
  customerId: z.uuid('Escolha um cliente válido.').optional(),
  professionalId: z.uuid('Escolha um profissional válido.').nullish(),
  startsAt: startsAtSchema,
  petId: z.uuid('Escolha o pet.').nullish(),
  durationMin: durationSchema.optional(),
  acknowledged: z.string().max(64).optional(),
  notes: optionalText(2000).nullable().optional(),
  customerNote: optionalText(500).nullable().optional(),
  idempotencyKey: z
    .string('Informe a chave de idempotência como texto.')
    .regex(/^[A-Za-z0-9_-]{1,80}$/, 'Use de 1 a 80 caracteres: letras, números, "-" e "_".')
    .optional(),
})

const rescheduleSchema = z.object({
  startsAt: startsAtSchema,
  professionalId: z.uuid('Escolha um profissional válido.').nullish(),
  durationMin: durationSchema.optional(),
  acknowledged: z.string().max(64).optional(),
})

const adjustSchema = z.object({
  petId: z.uuid('Escolha o pet.').optional(),
  durationMin: durationSchema.optional(),
  acknowledged: z.string().max(64).optional(),
  totalCents: z
    .number()
    .int('Informe o valor em centavos, sem fração.')
    .min(0, 'O valor não pode ser negativo.')
    .max(MAX_TOTAL_CENTS, 'O valor é alto demais.')
    .optional(),
  notes: optionalText(2000).nullable().optional(),
})

export function invalidProfessional(message = 'Este profissional não está disponível para esses serviços.'): DomainError {
  return new DomainError('validation', message, { fields: { professionalId: message } })
}

/** Candidatos que entram na trava de "qualquer um": para a equipe sem agenda geral, só o próprio. */
export function restrictToScope(who: Who, scope: Scope, candidates: Candidate[]): Candidate[] {
  if (who === 'staff' && !scope.all) return candidates.filter((c) => c.id === scope.ownId)
  return candidates
}

export function itemRows(ctx: TenantContext, appointmentId: string, items: Awaited<ReturnType<typeof resolveServices>>['items']) {
  return items.map((item, index) => ({
    businessId: ctx.businessId,
    appointmentId,
    serviceId: item.id,
    name: item.name,
    priceCents: item.priceCents,
    durationMin: item.durationMin,
    rewardPoints: item.rewardPoints,
    position: index + 1,
    variant: item.variant,
  }))
}

type BookingPet = { id: string; name: string; variant: PriceVariant }

/**
 * O pet da marcação e os serviços com preço e tempo dele. Conta pet: o pet é obrigatório e do cliente do agendamento;
 * conta sem nicho: `petId` informado é recusado. Lê com o `db` dado (fora ou dentro da transação).
 */
async function resolveBooking(
  ctx: TenantContext,
  db: Db,
  i: { petId: string | null; customerId: string; serviceIds: string[] },
): Promise<{ pet: BookingPet | null; services: Awaited<ReturnType<typeof resolveServices>> }> {
  const { niche } = await getNicheSettings(ctx, db)
  if (niche === null) {
    if (i.petId !== null) {
      const message = 'Esta loja não usa pets.'
      throw new DomainError('validation', message, { fields: { petId: message } })
    }
    return { pet: null, services: await resolveServices(ctx, i.serviceIds, db) }
  }
  if (i.petId === null) {
    const message = 'Escolha o pet.'
    throw new DomainError('validation', message, { fields: { petId: message } })
  }
  const pet = await loadPetForBooking(db, { petId: i.petId, customerId: i.customerId })
  return { pet, services: await resolveServices(ctx, i.serviceIds, db, { variant: pet.variant }) }
}

type BookInput = {
  customerId?: string
  professionalId?: string | null
  serviceIds: string[]
  /** Pet do atendimento: obrigatório em conta pet. */
  petId?: string | null
  startsAt: Date
  /** Duração em minutos (5 a 720): só a equipe; sem ela, a soma dos serviços. */
  durationMin?: number
  /** Impressão devolvida por `needs_confirmation`: só a equipe. */
  acknowledged?: string
  /** Anotação interna: só a equipe. */
  notes?: string | null
  /** Observação do cliente ao marcar. */
  customerNote?: string | null
  /**
   * Chave de idempotência (1 a 80 caracteres `[A-Za-z0-9_-]`): repetir o pedido igual com a mesma chave do mesmo
   * cliente em até 24 h devolve o mesmo agendamento, sem marcar de novo; um pedido diferente com a mesma chave é conflito.
   */
  idempotencyKey?: string
}

type KeyedRequest = { customerId: string; key: string; hash: string }

/** Nome do índice único parcial `(business_id, customer_id, idempotency_key)`, criado na migração. */
const IDEMPOTENCY_INDEX = 'appointments_idempotency_key_key'

function isIdempotencyViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== 'P2002') return false
  return JSON.stringify('meta' in err ? err.meta : {}).includes(IDEMPOTENCY_INDEX)
}

/**
 * Impressão do pedido (SHA-256 de uma forma canônica): serviços ordenados, instante em milissegundos, profissional pedido
 * (`null` = qualquer um) e observação do cliente aparada (vazia = `null`). É o que a repetição compara; nada de estado atual.
 */
export function idempotencyRequestHash(r: {
  serviceIds: string[]
  startsAt: Date
  professionalId?: string | null
  customerNote?: string | null
  petId?: string | null
}): string {
  const note = r.customerNote?.trim() ?? ''
  const base = [[...r.serviceIds].sort(), r.startsAt.getTime(), r.professionalId ?? null, note === '' ? null : note]
  // O pet entra só quando existe: as impressões antigas (sem pet) não mudam.
  const canonical = JSON.stringify(r.petId ? [...base, r.petId] : base)
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Já existe agendamento deste cliente com a chave? Pedido igual: devolve a visão dele (a repetição não marca nem avisa de
 * novo). Pedido diferente: `conflict` `idempotency_key_reused`. Chave com mais de 24 h: some do agendamento antigo
 * (só com `release`, dentro da transação de marcar) e o pedido segue como novo. `null` = nada a repetir.
 */
async function replayOfKey(
  ctx: TenantContext,
  db: Db,
  r: KeyedRequest,
  scope: Scope,
  release: Db | null,
): Promise<AppointmentView | null> {
  const found = await db.appointment.findFirst({
    where: { customerId: r.customerId, idempotencyKey: r.key },
    select: { id: true, idempotencyKeyAt: true, idempotencyRequestHash: true },
  })
  if (!found) return null
  if (found.idempotencyKeyAt === null || minutesBetween(found.idempotencyKeyAt, ctx.clock()) > IDEMPOTENCY_TTL_MIN) {
    if (release) await release.appointment.update({ where: { id: found.id }, data: { idempotencyKey: null, idempotencyKeyAt: null, idempotencyRequestHash: null } })
    return null
  }
  if (found.idempotencyRequestHash !== r.hash) {
    throw new DomainError(
      'conflict',
      'Esta chave de idempotência já foi usada em outro pedido. Gere uma chave nova para cada marcação diferente.',
      { reason: 'idempotency_key_reused' },
    )
  }
  // Pedido igual ao original: devolve o agendamento como está hoje (remarcado ou cancelado, se for o caso).
  const row = await reload(db, found.id)
  return toView(ctx, row, scope, (await getSchedulingRules(ctx, db)).customerChangeWindowMin)
}

/** Como `bookAppointment`, e diz se o resultado foi uma repetição idempotente (nada foi marcado nem avisado de novo). */
export async function bookAppointmentWithOutcome(
  ctx: TenantContext,
  i: BookInput,
): Promise<{ appointment: AppointmentView; replayed: boolean }> {
  const input = parse(bookSchema, {
    customerId: i.customerId,
    professionalId: i.professionalId,
    petId: i.petId,
    startsAt: i.startsAt,
    durationMin: i.durationMin,
    acknowledged: i.acknowledged,
    notes: i.notes,
    customerNote: i.customerNote,
    idempotencyKey: i.idempotencyKey,
  })
  const who = actorKind(ctx)
  if (who === 'customer' && input.durationMin !== undefined) throw forbidden(CUSTOMER_DURATION_MESSAGE)
  let customerId: string
  if (ctx.actor.kind === 'customer') {
    if (input.notes !== undefined && input.notes !== null) {
      throw forbidden('As anotações internas são da equipe. Escreva sua observação no campo de observação do cliente.')
    }
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

  const keyed: KeyedRequest | null =
    input.idempotencyKey === undefined
      ? null
      : {
          customerId,
          key: input.idempotencyKey,
          hash: idempotencyRequestHash({
            serviceIds: i.serviceIds,
            startsAt: input.startsAt,
            professionalId: specificId,
            customerNote: input.customerNote ?? null,
            petId: input.petId ?? null,
          }),
        }
  // Repetição de um pedido já atendido: responde antes de revalidar serviços e horário (que podem ter mudado desde então).
  if (keyed) {
    const replay = await replayOfKey(ctx, ctx.db, keyed, scope, null)
    if (replay) return { appointment: replay, replayed: true }
  }

  // Leitura prévia, só para validar cedo e saber quem travar; a decisão é refeita dentro da transação.
  const petId = input.petId ?? null
  const pre = (await resolveBooking(ctx, ctx.db, { petId, customerId, serviceIds: i.serviceIds })).services
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
  try {
    return await lockedTransaction(
      ctx,
      lockIds,
      () => ({ startsAt, durationMin: input.durationMin ?? pre.durationMin, professionalIds: lockIds }),
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
        // Já sob a trava do cliente: um pedido igual que acabou de terminar aparece aqui.
        if (keyed) {
          const replay = await replayOfKey(ctx, tx, keyed, scope, tx)
          if (replay) return { appointment: replay, replayed: true }
        }
        const rules = await getSchedulingRules(ctx, tx)
        const { pet, services } = await resolveBooking(ctx, tx, { petId, customerId, serviceIds: i.serviceIds })
        const durationMin = input.durationMin ?? services.durationMin
        const endsAt = addMinutes(startsAt, durationMin)
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
        const { professionalId } = await placeAppointment(ctx, tx, {
          who,
          eligible,
          specific: specificId !== null,
          startsAt,
          endsAt,
          durationMin,
          rules,
          acknowledged: input.acknowledged,
        })
        const isSqueezeIn = who === 'staff' && (await overlapsNormal(tx, { professionalId, startsAt, endsAt }))

        const by = party(ctx)
        const created = await tx.appointment.create({
          data: {
            businessId: ctx.businessId,
            customerId,
            professionalId,
            petId: pet?.id ?? null,
            isSqueezeIn,
            startsAt,
            endsAt,
            status: who === 'customer' && !rules.autoConfirm ? 'PENDING' : 'CONFIRMED',
            source: ctx.channel === 'app' ? 'APP' : 'PANEL',
            totalCents: services.totalCents,
            totalDurationMin: durationMin,
            notes: input.notes ?? null,
            customerNote: input.customerNote ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            idempotencyKeyAt: keyed === null ? null : ctx.clock(),
            idempotencyRequestHash: keyed === null ? null : keyed.hash,
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
        return { appointment: toView(ctx, row, scope, rules.customerChangeWindowMin), replayed: false }
      },
      { customerId },
    )
  } catch (err) {
    // Rede de segurança: o índice único cobre a corrida que a trava do cliente já impede. Quem perde relê e repete.
    if (keyed && isIdempotencyViolation(err)) {
      const replay = await replayOfKey(ctx, ctx.db, keyed, scope, null)
      if (replay) return { appointment: replay, replayed: true }
    }
    throw err
  }
}

export async function bookAppointment(ctx: TenantContext, i: BookInput): Promise<AppointmentView> {
  return (await bookAppointmentWithOutcome(ctx, i)).appointment
}

export async function rescheduleAppointment(
  ctx: TenantContext,
  id: string,
  i: { startsAt: Date; professionalId?: string | null; serviceIds?: string[]; durationMin?: number; acknowledged?: string },
): Promise<AppointmentView> {
  const input = parse(rescheduleSchema, {
    startsAt: i.startsAt,
    professionalId: i.professionalId,
    durationMin: i.durationMin,
    acknowledged: i.acknowledged,
  })
  const who = actorKind(ctx)
  if (who === 'customer' && input.durationMin !== undefined) throw forbidden(CUSTOMER_DURATION_MESSAGE)
  if (who === 'staff') assertStaffStart(ctx, input.startsAt)
  const scope = await staffScope(ctx, who)
  const before = await loadForActor(ctx, ctx.db, id, who, scope)
  if (!OPEN_STATUSES.includes(before.status)) {
    throw invalidTransition('Só dá para remarcar agendamentos pendentes ou confirmados.')
  }

  const keepProfessional = input.professionalId === undefined
  const specificId = keepProfessional ? before.professionalId : input.professionalId
  if (specificId) assertProfessionalAllowed(who, scope, specificId)
  const changesServices = i.serviceIds !== undefined
  const variant = before.pet === null ? null : variantOfPet(before.pet)
  const pre = changesServices ? await resolveServices(ctx, i.serviceIds ?? [], ctx.db, { variant }) : null
  const serviceIds = i.serviceIds ?? before.items.map((item) => item.serviceId)

  const anyIds = specificId
    ? []
    : restrictToScope(who, scope, await listCandidates(ctx, serviceIds)).map((c) => c.id)
  const lockIds = [before.professionalId, ...(specificId ? [specificId] : anyIds)]
  const durationHint = input.durationMin ?? pre?.durationMin ?? before.totalDurationMin

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
      if (!OPEN_STATUSES.includes(row.status)) {
        throw invalidTransition('Só dá para remarcar agendamentos pendentes ou confirmados.')
      }
      assertProfessionalUnchanged(row, lockIds)
      const rules = await getSchedulingRules(ctx, tx)
      if (who === 'customer') assertCustomerWindow(ctx, rules, row.startsAt, 'remarcar')

      const services = changesServices ? await resolveServices(ctx, i.serviceIds ?? [], tx, { variant }) : null
      const durationMin = input.durationMin ?? services?.durationMin ?? row.totalDurationMin
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
      const { professionalId } = await placeAppointment(ctx, tx, {
        who,
        eligible,
        specific: specificId !== null,
        startsAt: input.startsAt,
        endsAt,
        durationMin,
        rules,
        ignoreAppointmentId: id,
        acknowledged: input.acknowledged,
      })
      // Quem se move recalcula a própria marca antes de qualquer reavaliação: não toma o lugar de um encaixe.
      const isSqueezeIn =
        who === 'staff' && (await overlapsNormal(tx, { professionalId, startsAt: input.startsAt, endsAt, ignoreAppointmentId: id }))

      await tx.appointment.update({
        where: { id },
        data: {
          startsAt: input.startsAt,
          endsAt,
          professionalId,
          isSqueezeIn,
          totalDurationMin: durationMin,
          ...(services ? { totalCents: services.totalCents } : {}),
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
      await afterChange(tx, ctx, 'rescheduled', updated, {
        previousStartsAt: row.startsAt.getTime(),
        previousProfessionalId: row.professionalId,
      })
      return toView(ctx, updated, scope, rules.customerChangeWindowMin)
    },
  )
}

export async function adjustAppointment(
  ctx: TenantContext,
  id: string,
  i: {
    serviceIds?: string[]
    petId?: string
    durationMin?: number
    totalCents?: number
    notes?: string | null
    acknowledged?: string
  },
): Promise<AppointmentView> {
  const who = actorKind(ctx)
  if (who === 'customer') throw forbidden()
  const input = parse(adjustSchema, {
    petId: i.petId,
    durationMin: i.durationMin,
    acknowledged: i.acknowledged,
    totalCents: i.totalCents,
    notes: i.notes,
  })
  if (input.totalCents !== undefined && !can(ctx.actor, 'view_all_agendas')) {
    throw forbidden('Só quem vê todas as agendas pode alterar o valor do atendimento.')
  }
  const scope = await staffScope(ctx, who)
  const before = await loadForActor(ctx, ctx.db, id, who, scope)
  if (!OPEN_STATUSES.includes(before.status)) {
    throw invalidTransition('Só dá para ajustar agendamentos pendentes ou confirmados.')
  }
  const hintMin = input.durationMin ?? before.totalDurationMin

  return lockedTransaction(
    ctx,
    [before.professionalId],
    () => ({
      startsAt: before.startsAt,
      durationMin: hintMin,
      professionalIds: [before.professionalId],
      ignoreAppointmentId: id,
    }),
    async (tx) => {
      const row = await loadForActor(ctx, tx, id, who, scope)
      assertProfessionalUnchanged(row, [before.professionalId])
      if (!OPEN_STATUSES.includes(row.status)) {
        throw invalidTransition('Só dá para ajustar agendamentos pendentes ou confirmados.')
      }
      const rules = await getSchedulingRules(ctx, tx)
      const data: Prisma.AppointmentUncheckedUpdateInput = {}
      const fields: string[] = []

      // O pet do atendimento: o novo (ativo e do mesmo cliente) ou o que já estava.
      const { niche } = await getNicheSettings(ctx, tx)
      if (input.petId !== undefined && niche === null) {
        const message = 'Esta loja não usa pets.'
        throw new DomainError('validation', message, { fields: { petId: message } })
      }
      const newPet = input.petId !== undefined && input.petId !== row.petId
        ? await loadPetForBooking(tx, { petId: input.petId, customerId: row.customerId })
        : null
      const currentVariant = row.pet === null ? null : variantOfPet(row.pet)
      const variant = newPet?.variant ?? currentVariant
      const redoItems = i.serviceIds !== undefined || newPet !== null
      if (redoItems && niche !== null && variant === null) {
        const message = 'Escolha o pet.'
        throw new DomainError('validation', message, { fields: { petId: message } })
      }
      const services = redoItems
        ? await resolveServices(ctx, i.serviceIds ?? row.items.map((item) => item.serviceId), tx, { variant })
        : null
      if (services) {
        const candidates = await listCandidates(ctx, services.items.map((s) => s.id), tx)
        if (!candidates.some((c) => c.id === row.professionalId)) {
          const message = 'Este profissional não faz algum dos serviços escolhidos.'
          throw new DomainError('validation', message, { fields: { serviceIds: message } })
        }
        data.totalCents = services.totalCents
        fields.push('serviceIds')
      }
      if (newPet) {
        data.petId = newPet.id
        fields.push('petId')
      }
      const durationMin = input.durationMin ?? services?.durationMin ?? row.totalDurationMin
      const endsAt = addMinutes(row.startsAt, durationMin)
      if (endsAt.getTime() !== row.endsAt.getTime()) {
        // Só o que o novo intervalo traz de novo precisa de confirmação: o que já estava no antigo a pessoa já aceitou.
        const novos = await staffIssues(ctx, tx, { professionalId: row.professionalId, startsAt: row.startsAt, endsAt, ignoreAppointmentId: id })
        const antigos = new Set(
          (await staffIssues(ctx, tx, { professionalId: row.professionalId, startsAt: row.startsAt, endsAt: row.endsAt, ignoreAppointmentId: id })).map((x) => x.key),
        )
        await confirmStaffIssues(ctx, tx, {
          professionalId: row.professionalId,
          startsAt: row.startsAt,
          endsAt,
          issues: novos.filter((x) => !antigos.has(x.key)),
          acknowledged: input.acknowledged,
          durationMin,
          ignoreAppointmentId: id,
        })
        data.endsAt = endsAt
        data.totalDurationMin = durationMin
        data.isSqueezeIn = await overlapsNormal(tx, { professionalId: row.professionalId, startsAt: row.startsAt, endsAt, ignoreAppointmentId: id })
        if (input.durationMin !== undefined) fields.push('durationMin')
      }
      if (input.totalCents !== undefined) {
        data.totalCents = input.totalCents
        fields.push('totalCents')
      }
      if (input.notes !== undefined) {
        data.notes = input.notes
        fields.push('notes')
      }
      if (fields.length === 0 && data.endsAt === undefined) return toView(ctx, row, scope, rules.customerChangeWindowMin)

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
      return toView(ctx, updated, scope, rules.customerChangeWindowMin)
    },
  )
}

export async function getAppointment(ctx: TenantContext, id: string): Promise<AppointmentView> {
  const who = actorKind(ctx)
  const scope = await staffScope(ctx, who)
  const row = await loadForActor(ctx, ctx.db, id, who, scope)
  const rules = await getSchedulingRules(ctx)
  return toView(ctx, row, scope, rules.customerChangeWindowMin)
}
