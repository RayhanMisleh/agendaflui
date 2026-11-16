import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type {
  AppointmentStatus,
  NotificationChannel,
  NotificationKind,
  Prisma,
} from '@/server/db/generated/client'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { DomainError, z } from '@/server/domain/errors'
import { getNotificationSettings } from '@/server/domain/settings/notification-settings'
import { ownProfessionalId } from '@/server/domain/team/professionals'
import { addMinutes, localParts, toIsoInstant, todayIn } from '@/server/time'

export type AppointmentEvent =
  | 'booked'
  | 'confirmed'
  | 'canceled'
  | 'rescheduled'
  | 'completed'
  | 'outcome_undone'
  | 'no_show'

type EventAppointment = {
  id: string
  customerId: string
  professionalId: string
  startsAt: Date
  status: AppointmentStatus
}

type Row = Prisma.NotificationCreateManyInput

const REMINDERS: readonly { kind: NotificationKind; minutesBefore: number }[] = [
  { kind: 'APPOINTMENT_REMINDER_24H', minutesBefore: 1440 },
  { kind: 'APPOINTMENT_REMINDER_1H', minutesBefore: 60 },
]
const REMINDER_KINDS: NotificationKind[] = REMINDERS.map((r) => r.kind)
const CHANNELS: readonly NotificationChannel[] = ['EMAIL', 'PUSH']
const REMINDABLE: readonly AppointmentStatus[] = ['PENDING', 'CONFIRMED']

type Side = 'staff' | 'customer' | null

/** Quem agiu: equipe (membro ou suporte), cliente do app, ou ninguém que gere aviso (sistema, admin). */
function sideOf(ctx: TenantContext): Side {
  switch (ctx.actor.kind) {
    case 'member':
    case 'impersonator':
      return 'staff'
    case 'customer':
      return 'customer'
    default:
      return null
  }
}

type Recipient = { customerId: string } | { membershipId: string }

type Plan = {
  tx: TenantTx
  ctx: TenantContext
  appt: EventAppointment
  enabled: Awaited<ReturnType<typeof getNotificationSettings>>
}

function payloadOf(appt: EventAppointment, previousStartsAt?: Date): Prisma.InputJsonObject {
  return {
    appointmentId: appt.id,
    startsAt: toIsoInstant(appt.startsAt),
    ...(previousStartsAt ? { previousStartsAt: toIsoInstant(previousStartsAt) } : {}),
  }
}

/** Uma linha por canal ligado na conta. `withStart` põe o início na chave, para o aviso valer por horário. */
function rowsFor(
  plan: Plan,
  kind: NotificationKind,
  to: Recipient,
  o: { scheduledFor: Date; withStart: boolean; previousStartsAt?: Date },
): Row[] {
  const toggle = plan.enabled[kind]
  return CHANNELS.filter((channel) => (channel === 'EMAIL' ? toggle.email : toggle.push)).map((channel) => ({
    businessId: plan.ctx.businessId,
    kind,
    channel,
    ...to,
    appointmentId: plan.appt.id,
    scheduledFor: o.scheduledFor,
    payload: payloadOf(plan.appt, o.previousStartsAt),
    dedupeKey: `${kind}:${channel}:${plan.appt.id}${o.withStart ? `:${plan.appt.startsAt.getTime()}` : ''}`,
  }))
}

/** Grava sem abortar a transação quando a linha já existe (`dedupe_key` único por conta). */
async function insert(tx: TenantTx, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0
  const { count } = await tx.notification.createMany({ data: rows, skipDuplicates: true })
  return count
}

async function customerCanReceive(tx: TenantTx, customerId: string): Promise<boolean> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, archivedAt: null, anonymizedAt: null },
    select: { id: true },
  })
  return customer !== null
}

async function professionalMembership(tx: TenantTx, professionalId: string): Promise<string | null> {
  const professional = await tx.professional.findUnique({ where: { id: professionalId }, select: { membershipId: true } })
  return professional?.membershipId ?? null
}

async function cancelPendingReminders(tx: TenantTx, appointmentId: string): Promise<void> {
  await tx.notification.updateMany({
    where: { appointmentId, kind: { in: REMINDER_KINDS }, status: 'PENDING' },
    data: { status: 'CANCELED' },
  })
}

/** Cria os lembretes que ainda estão no futuro; um lembrete cancelado do mesmo horário volta a valer. */
async function ensureReminders(plan: Plan): Promise<void> {
  const { tx, ctx, appt } = plan
  if (!REMINDABLE.includes(appt.status)) return
  const now = ctx.clock()
  const rows: Row[] = []
  for (const { kind, minutesBefore } of REMINDERS) {
    const scheduledFor = addMinutes(appt.startsAt, -minutesBefore)
    if (scheduledFor.getTime() > now.getTime()) {
      rows.push(...rowsFor(plan, kind, { customerId: appt.customerId }, { scheduledFor, withStart: true }))
    }
  }
  await insert(tx, rows)
  if (rows.length === 0) return
  await tx.notification.updateMany({
    where: { dedupeKey: { in: rows.map((r) => r.dedupeKey) }, status: 'CANCELED' },
    data: { status: 'PENDING', attempts: 0, lastError: null },
  })
}

/**
 * Grava, na transação da operação, os avisos de um evento do agendamento. Idempotente: repetir o evento
 * não duplica linhas. O envio é de outra fase.
 */
export async function enqueueAppointmentEvent(
  tx: TenantTx,
  ctx: TenantContext,
  event: AppointmentEvent,
  appt: EventAppointment,
  opts: { previousStartsAt?: Date } = {},
): Promise<void> {
  if (event === 'outcome_undone') return
  const plan: Plan = { tx, ctx, appt, enabled: await getNotificationSettings(ctx, tx) }
  const now = ctx.clock()
  const side = sideOf(ctx)
  const customerOk = event === 'no_show' ? false : await customerCanReceive(tx, appt.customerId)
  const toCustomer = { customerId: appt.customerId }

  switch (event) {
    case 'booked': {
      const rows: Row[] = []
      if (customerOk) {
        rows.push(...rowsFor(plan, 'APPOINTMENT_CONFIRMED', toCustomer, { scheduledFor: now, withStart: true }))
      }
      if (side === 'customer') {
        const membershipId = await professionalMembership(tx, appt.professionalId)
        if (membershipId) rows.push(...rowsFor(plan, 'STAFF_NEW_APPOINTMENT', { membershipId }, { scheduledFor: now, withStart: false }))
      }
      await insert(tx, rows)
      if (customerOk) await ensureReminders(plan)
      return
    }
    case 'confirmed': {
      if (!customerOk) return
      await insert(tx, rowsFor(plan, 'APPOINTMENT_CONFIRMED', toCustomer, { scheduledFor: now, withStart: true }))
      await ensureReminders(plan)
      return
    }
    case 'canceled': {
      await cancelPendingReminders(tx, appt.id)
      const rows: Row[] = []
      if (side === 'staff' && customerOk) {
        rows.push(...rowsFor(plan, 'APPOINTMENT_CANCELED', toCustomer, { scheduledFor: now, withStart: false }))
      }
      if (side === 'customer') {
        const membershipId = await professionalMembership(tx, appt.professionalId)
        if (membershipId) rows.push(...rowsFor(plan, 'STAFF_APPOINTMENT_CANCELED', { membershipId }, { scheduledFor: now, withStart: false }))
      }
      await insert(tx, rows)
      return
    }
    case 'rescheduled': {
      const moved = opts.previousStartsAt === undefined || opts.previousStartsAt.getTime() !== appt.startsAt.getTime()
      if (moved) await cancelPendingReminders(tx, appt.id)
      const rows: Row[] = []
      const extra = opts.previousStartsAt ? { previousStartsAt: opts.previousStartsAt } : {}
      if (side === 'staff' && customerOk) {
        rows.push(...rowsFor(plan, 'APPOINTMENT_RESCHEDULED', toCustomer, { scheduledFor: now, withStart: true, ...extra }))
      }
      if (side === 'customer') {
        const membershipId = await professionalMembership(tx, appt.professionalId)
        if (membershipId) {
          rows.push(...rowsFor(plan, 'STAFF_APPOINTMENT_RESCHEDULED', { membershipId }, { scheduledFor: now, withStart: true, ...extra }))
        }
      }
      await insert(tx, rows)
      if (customerOk) await ensureReminders(plan)
      return
    }
    case 'completed': {
      await cancelPendingReminders(tx, appt.id)
      if (customerOk) {
        await insert(tx, rowsFor(plan, 'APPOINTMENT_COMPLETED', toCustomer, { scheduledFor: now, withStart: false }))
      }
      return
    }
    case 'no_show': {
      await cancelPendingReminders(tx, appt.id)
      return
    }
  }
}

/** Cancela os avisos ainda pendentes do cliente (arquivado ou anonimizado não recebe mais nada). */
export async function cancelPendingForCustomer(tx: TenantTx, customerId: string): Promise<void> {
  await tx.notification.updateMany({ where: { customerId, status: 'PENDING' }, data: { status: 'CANCELED' } })
}

const idSchema = z.uuid()

/** A equipe avisa o cliente de que o profissional já está livre. Vale para um agendamento confirmado de hoje, ainda não iniciado. */
export async function notifyProfessionalFreeEarly(ctx: TenantContext, appointmentId: string): Promise<void> {
  if (!can(ctx.actor, 'view_own_agenda')) {
    throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
  }
  const notFound = () => new DomainError('not_found', 'Agendamento não encontrado.')
  if (!idSchema.safeParse(appointmentId).success) throw notFound()
  const all = can(ctx.actor, 'view_all_agendas')
  const own = all ? null : await ownProfessionalId(ctx)

  await ctx.db.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id: appointmentId } })
    if (!appt) throw notFound()
    if (!all && appt.professionalId !== own) {
      throw new DomainError('forbidden', 'Você só pode agir na sua própria agenda.')
    }
    const now = ctx.clock()
    if (appt.status !== 'CONFIRMED') {
      throw new DomainError('conflict', 'Só dá para avisar sobre agendamentos confirmados.', { reason: 'invalid_status' })
    }
    if (localParts(appt.startsAt, ctx.timeZone).date !== todayIn(ctx.timeZone, now)) {
      throw new DomainError('conflict', 'Só dá para avisar sobre agendamentos de hoje.', { reason: 'not_today' })
    }
    if (appt.startsAt.getTime() <= now.getTime()) {
      throw new DomainError('conflict', 'Este atendimento já começou. Não há mais o que antecipar.', { reason: 'already_started' })
    }
    const plan: Plan = { tx, ctx, appt, enabled: await getNotificationSettings(ctx, tx) }
    const queued = (await customerCanReceive(tx, appt.customerId))
      ? await insert(
          tx,
          rowsFor(plan, 'PROFESSIONAL_FREE_EARLY', { customerId: appt.customerId }, { scheduledFor: now, withStart: false }),
        )
      : 0
    await audit(
      ctx,
      { action: 'appointment.free_early_notified', targetType: 'Appointment', targetId: appt.id, metadata: { queued } },
      tx,
    )
  })
}
