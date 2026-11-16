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
