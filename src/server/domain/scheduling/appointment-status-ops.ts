import type { TenantContext } from '@/server/auth/actor'
import type { AppointmentStatus, Prisma } from '@/server/db/generated/client'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { DomainError, parse, z } from '@/server/domain/errors'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import {
  actorKind,
  afterChange,
  forbidden,
  invalidTransition,
  loadForActor,
  optionalText,
  party,
  reload,
  staffScope,
  toView,
  type AppointmentView,
  type ChangeEvent,
  type Row,
} from '@/server/domain/scheduling/appointment-view'
import { assertCustomerWindow, assertProfessionalUnchanged, lockedTransaction } from '@/server/domain/scheduling/placement'
import { canTransition } from '@/server/domain/scheduling/status'

const cancelSchema = z.object({ reason: optionalText(300).nullable().optional() })

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
  /** Texto do erro `slot_taken` quando a mudança volta a ocupar um horário que outro agendamento tomou. */
  slotTakenMessage?: string
  /** Dados a mais para os avisos do evento (ver `afterChange`). */
  eventExtra?: Record<string, string | number | null>
}

function assertTransition(row: Row, spec: StatusChange): void {
  if (!canTransition(row.status, spec.to) || (spec.from && !spec.from.includes(row.status))) {
    throw invalidTransition(spec.invalid)
  }
}

/**
 * Aplica a mudança de situação dentro de uma transação que já tem a trava do profissional: confere a
 * transição, grava, audita e enfileira os avisos. Não confere prazo nem permissão de quem pede.
 */
async function applyChange(tx: TenantTx, ctx: TenantContext, row: Row, spec: StatusChange): Promise<Row> {
  assertTransition(row, spec)
  const extra = spec.prepare ? await spec.prepare(tx, row) : {}
  await tx.appointment.update({ where: { id: row.id }, data: { status: spec.to, ...extra } })
  await audit(
    ctx,
    {
      action: spec.action,
      targetType: 'Appointment',
      targetId: row.id,
      metadata: { from: row.status, to: spec.to, ...(spec.metadata?.(row, extra) ?? {}) },
    },
    tx,
  )
  const updated = await reload(tx, row.id)
  await afterChange(tx, ctx, spec.event, updated, { from: row.status, ...(spec.eventExtra ?? {}) })
  return updated
}

async function changeStatus(ctx: TenantContext, id: string, spec: StatusChange): Promise<AppointmentView> {
  const who = actorKind(ctx)
  if (who === 'customer' && !spec.customerVerb) throw forbidden()
  const scope = await staffScope(ctx, who)
  const before = await loadForActor(ctx, ctx.db, id, who, scope)

  try {
    return await lockedTransaction(
      ctx,
      [before.professionalId],
      () => ({ startsAt: before.startsAt, durationMin: before.totalDurationMin, professionalIds: [before.professionalId], ignoreAppointmentId: id }),
      async (tx) => {
        const row = await loadForActor(ctx, tx, id, who, scope)
        assertProfessionalUnchanged(row, [before.professionalId])
        assertTransition(row, spec)
        if (who === 'customer') {
          assertCustomerWindow(ctx, await getSchedulingRules(ctx, tx), row.startsAt, spec.customerVerb ?? '')
        }
        return toView(ctx, await applyChange(tx, ctx, row, spec), scope)
      },
    )
  } catch (err) {
    if (spec.slotTakenMessage && err instanceof DomainError && err.reason === 'slot_taken') {
      throw new DomainError('conflict', spec.slotTakenMessage, { reason: 'slot_taken' })
    }
    throw err
  }
}

function cancelSpec(ctx: TenantContext, reason: string | null, eventExtra?: StatusChange['eventExtra']): StatusChange {
  const by = party(ctx)
  return {
    to: 'CANCELED',
    action: 'appointment.canceled',
    event: 'canceled',
    invalid: 'Só dá para cancelar agendamentos pendentes ou confirmados.',
    customerVerb: 'cancelar',
    ...(eventExtra ? { eventExtra } : {}),
    prepare: async () => ({
      canceledAt: ctx.clock(),
      canceledByType: by.type,
      canceledById: by.id,
      cancelReason: reason,
    }),
  }
}

export async function cancelAppointment(
  ctx: TenantContext,
  id: string,
  i: { reason?: string | null } = {},
): Promise<AppointmentView> {
  const { reason } = parse(cancelSchema, i)
  return changeStatus(ctx, id, cancelSpec(ctx, reason ?? null))
}

/**
 * Cancela um agendamento dentro de uma transação que já tem a trava do profissional (cadastro removido).
 * Sem prazo do cliente; o membro do profissional é avisado, qualquer que seja quem cancela.
 */
export async function cancelWithinTransaction(tx: TenantTx, ctx: TenantContext, id: string, reason: string): Promise<void> {
  await applyChange(tx, ctx, await reload(tx, id), cancelSpec(ctx, reason, { notifyProfessional: 1 }))
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
    slotTakenMessage: 'Não dá para desfazer: o horário já está ocupado por outro agendamento.',
    prepare: async () => ({ completedAt: null, commissionCents: null }),
  })
}
