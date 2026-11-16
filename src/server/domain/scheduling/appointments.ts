import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { Prisma } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { DomainError, parse, z } from '@/server/domain/errors'
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
  type Scope,
  type Who,
} from '@/server/domain/scheduling/appointment-view'
import {
  assertCustomerWindow,
  assertFreeForStaff,
  assertProfessionalUnchanged,
  assertStaffStart,
  lockedTransaction,
  placeAppointment,
} from '@/server/domain/scheduling/placement'
import { OPEN_STATUSES } from '@/server/domain/scheduling/status'
import { addMinutes, toIsoInstant } from '@/server/time'

export {
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  markNoShow,
  undoOutcome,
} from '@/server/domain/scheduling/appointment-status-ops'
export type { AppointmentView } from '@/server/domain/scheduling/appointment-view'

const MAX_TOTAL_CENTS = 10_000_000

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

const adjustSchema = z.object({
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
      return toView(ctx, row, scope)
    },
    { customerId },
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
  if (!OPEN_STATUSES.includes(before.status)) {
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
      if (!OPEN_STATUSES.includes(row.status)) {
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
      await afterChange(tx, ctx, 'rescheduled', updated, {
        previousStartsAt: row.startsAt.getTime(),
        previousProfessionalId: row.professionalId,
      })
      return toView(ctx, updated, scope)
    },
  )
}

export async function adjustAppointment(
  ctx: TenantContext,
  id: string,
  i: { serviceIds?: string[]; totalCents?: number; notes?: string | null },
): Promise<AppointmentView> {
  const who = actorKind(ctx)
  if (who === 'customer') throw forbidden()
  const input = parse(adjustSchema, { totalCents: i.totalCents, notes: i.notes })
  if (input.totalCents !== undefined && !can(ctx.actor, 'view_all_agendas')) {
    throw forbidden('Só quem vê todas as agendas pode alterar o valor do atendimento.')
  }
  const scope = await staffScope(ctx, who)
  const before = await loadForActor(ctx, ctx.db, id, who, scope)
  if (!OPEN_STATUSES.includes(before.status)) {
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
      if (!OPEN_STATUSES.includes(row.status)) {
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
          blockedMessage:
            'Com esses serviços o atendimento invade um bloqueio da agenda. Escolha outros serviços ou remova o bloqueio.',
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
      if (fields.length === 0) return toView(ctx, row, scope)

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
      return toView(ctx, updated, scope)
    },
  )
}

export async function getAppointment(ctx: TenantContext, id: string): Promise<AppointmentView> {
  const who = actorKind(ctx)
  const scope = await staffScope(ctx, who)
  return toView(ctx, await loadForActor(ctx, ctx.db, id, who, scope), scope)
}
