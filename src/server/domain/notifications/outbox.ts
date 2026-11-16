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

/** `customer` e `professional` são opcionais: quem já os carregou evita duas consultas dentro da trava. */
type EventAppointment = {
  id: string
  customerId: string
  professionalId: string
  startsAt: Date
  updatedAt: Date
  status: AppointmentStatus
  customer?: { archivedAt: Date | null; anonymizedAt: Date | null }
  professional?: { membershipId: string | null }
}

type Row = Prisma.NotificationCreateManyInput

const REMINDERS: readonly { kind: NotificationKind; minutesBefore: number }[] = [
  { kind: 'APPOINTMENT_REMINDER_24H', minutesBefore: 1440 },
  { kind: 'APPOINTMENT_REMINDER_1H', minutesBefore: 60 },
]
const REMINDER_KINDS: NotificationKind[] = REMINDERS.map((r) => r.kind)
const CHANNELS: readonly NotificationChannel[] = ['EMAIL', 'PUSH']

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

function payloadOf(appt: EventAppointment, startsAt: Date, previousStartsAt?: Date): Prisma.InputJsonObject {
  return {
    appointmentId: appt.id,
    startsAt: toIsoInstant(startsAt),
    ...(previousStartsAt ? { previousStartsAt: toIsoInstant(previousStartsAt) } : {}),
  }
}

type RowOptions = {
  scheduledFor: Date
  /** Sufixo da chave de deduplicação; sem ele, o aviso vale uma vez por agendamento. */
  suffix?: number
  /** Início que vai no payload (padrão: o atual). */
  startsAt?: Date
  previousStartsAt?: Date
}

/** Uma linha por canal ligado na conta. */
function rowsFor(plan: Plan, kind: NotificationKind, to: Recipient, o: RowOptions): Row[] {
  const toggle = plan.enabled[kind]
  return CHANNELS.filter((channel) => (channel === 'EMAIL' ? toggle.email : toggle.push)).map((channel) => ({
    businessId: plan.ctx.businessId,
    kind,
    channel,
    ...to,
    appointmentId: plan.appt.id,
    scheduledFor: o.scheduledFor,
    payload: payloadOf(plan.appt, o.startsAt ?? plan.appt.startsAt, o.previousStartsAt),
    dedupeKey: `${kind}:${channel}:${plan.appt.id}${o.suffix === undefined ? '' : `:${o.suffix}`}`,
  }))
}

/** Grava sem abortar a transação quando a linha já existe (`dedupe_key` único por conta). */
async function insert(tx: TenantTx, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0
  const { count } = await tx.notification.createMany({ data: rows, skipDuplicates: true })
  return count
}

async function customerCanReceive(tx: TenantTx, appt: EventAppointment): Promise<boolean> {
  if (appt.customer) return appt.customer.archivedAt === null && appt.customer.anonymizedAt === null
  const customer = await tx.customer.findFirst({
    where: { id: appt.customerId, archivedAt: null, anonymizedAt: null },
    select: { id: true },
  })
  return customer !== null
}

async function membershipOf(tx: TenantTx, professionalId: string, loaded?: { membershipId: string | null }): Promise<string | null> {
  if (loaded) return loaded.membershipId
  const professional = await tx.professional.findUnique({ where: { id: professionalId }, select: { membershipId: true } })
  return professional?.membershipId ?? null
}

async function cancelPendingReminders(tx: TenantTx, appointmentId: string): Promise<void> {
  await tx.notification.updateMany({
    where: { appointmentId, kind: { in: REMINDER_KINDS }, status: 'PENDING' },
    data: { status: 'CANCELED' },
  })
}

/** Lembretes que ainda estão no futuro; só agendamento confirmado tem lembrete. */
function reminderRows(plan: Plan): Row[] {
  const { ctx, appt } = plan
  if (appt.status !== 'CONFIRMED') return []
  const now = ctx.clock().getTime()
  return REMINDERS.flatMap(({ kind, minutesBefore }) => {
    const scheduledFor = addMinutes(appt.startsAt, -minutesBefore)
    if (scheduledFor.getTime() <= now) return []
    return rowsFor(plan, kind, { customerId: appt.customerId }, { scheduledFor, suffix: appt.startsAt.getTime() })
  })
}

/** Um lembrete cancelado do mesmo horário (A -> B -> A) volta a valer. */
async function reviveReminders(tx: TenantTx, rows: Row[]): Promise<void> {
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
  opts: { previousStartsAt?: Date; previousProfessionalId?: string } = {},
): Promise<void> {
  if (event === 'outcome_undone') return
  const side = sideOf(ctx)
  const now = ctx.clock()
  const toCustomer = { customerId: appt.customerId }

  if (event === 'no_show') {
    await cancelPendingReminders(tx, appt.id)
    return
  }
  if (event === 'canceled' || event === 'completed') await cancelPendingReminders(tx, appt.id)
  let moved = false
  if (event === 'rescheduled') {
    moved = opts.previousStartsAt === undefined || opts.previousStartsAt.getTime() !== appt.startsAt.getTime()
    if (moved) await cancelPendingReminders(tx, appt.id)
  }

  const plan: Plan = { tx, ctx, appt, enabled: await getNotificationSettings(ctx, tx) }
  const customerOk = await customerCanReceive(tx, appt)
  const rows: Row[] = []
  const staff = (kind: NotificationKind, membershipId: string | null, o: RowOptions) => {
    if (membershipId) rows.push(...rowsFor(plan, kind, { membershipId }, o))
  }
  let reminders: Row[] = []

  switch (event) {
    case 'booked': {
      if (customerOk) {
        const kind = appt.status === 'PENDING' ? 'APPOINTMENT_REQUESTED' : 'APPOINTMENT_CONFIRMED'
        rows.push(...rowsFor(plan, kind, toCustomer, { scheduledFor: now, suffix: appt.startsAt.getTime() }))
        reminders = reminderRows(plan)
      }
      if (side === 'customer') {
        staff('STAFF_NEW_APPOINTMENT', await membershipOf(tx, appt.professionalId, appt.professional), { scheduledFor: now })
      }
      break
    }
    case 'confirmed': {
      if (!customerOk) return
      rows.push(...rowsFor(plan, 'APPOINTMENT_CONFIRMED', toCustomer, { scheduledFor: now, suffix: appt.startsAt.getTime() }))
      reminders = reminderRows(plan)
      break
    }
    case 'canceled': {
      if (side === 'staff' && customerOk) {
        rows.push(...rowsFor(plan, 'APPOINTMENT_CANCELED', toCustomer, { scheduledFor: now }))
      }
      if (side === 'customer') {
        staff('STAFF_APPOINTMENT_CANCELED', await membershipOf(tx, appt.professionalId, appt.professional), { scheduledFor: now })
      }
      break
    }
    case 'rescheduled': {
      const unique = appt.updatedAt.getTime()
      const previous = opts.previousStartsAt ? { previousStartsAt: opts.previousStartsAt } : {}
      if (side === 'staff' && customerOk) {
        rows.push(...rowsFor(plan, 'APPOINTMENT_RESCHEDULED', toCustomer, { scheduledFor: now, suffix: unique, ...previous }))
      }
      if (side === 'customer') {
        const current = await membershipOf(tx, appt.professionalId, appt.professional)
        staff('STAFF_APPOINTMENT_RESCHEDULED', current, { scheduledFor: now, suffix: unique, ...previous })
        const before = opts.previousProfessionalId
        if (before !== undefined && before !== appt.professionalId) {
          const old = await membershipOf(tx, before)
          if (old !== current) {
            staff('STAFF_APPOINTMENT_CANCELED', old, {
              scheduledFor: now,
              suffix: unique,
              startsAt: opts.previousStartsAt ?? appt.startsAt,
            })
          }
        }
      }
      if (customerOk) reminders = reminderRows(plan)
      break
    }
    case 'completed': {
      if (customerOk) rows.push(...rowsFor(plan, 'APPOINTMENT_COMPLETED', toCustomer, { scheduledFor: now }))
      break
    }
  }

  await insert(tx, [...rows, ...reminders])
  if (event === 'rescheduled' && moved) await reviveReminders(tx, reminders)
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
    const queued = (await customerCanReceive(tx, appt))
      ? await insert(
          tx,
          rowsFor(plan, 'PROFESSIONAL_FREE_EARLY', { customerId: appt.customerId }, { scheduledFor: now }),
        )
      : 0
    await audit(
      ctx,
      { action: 'appointment.free_early_notified', targetType: 'Appointment', targetId: appt.id, metadata: { queued } },
      tx,
    )
  })
}
