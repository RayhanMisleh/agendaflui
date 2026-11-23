import { prisma } from '@/server/db/client'
import type {
  AppointmentStatus,
  BusinessStatus,
  NotificationChannel,
  NotificationKind,
} from '@/server/db/generated/client'
import { resolveNotificationSettings, type NotificationSettings } from '@/server/domain/settings/notification-settings'

/*
 * O que o envio sabe sobre uma linha da fila, recarregado do banco na hora de enviar. O worker atravessa contas por
 * desenho: toda consulta de conta aqui filtra pelo `businessId` da linha reservada.
 */

export type LoadedPayload = { startsAt: string | null; previousStartsAt: string | null; reason: string | null; audience: string | null }

export type LoadedAppointment = {
  id: string
  status: AppointmentStatus
  startsAt: Date
  endsAt: Date
  totalCents: number
  cancelReason: string | null
  customerName: string
  professionalName: string
  professionalMembershipId: string | null
  services: string[]
}

/** Quem recebe. `active`: cliente nem arquivado nem anonimizado, ou vínculo ativo. Membro não tem preferência: `allow*` é sempre `true`. */
export type LoadedRecipient = {
  kind: 'customer' | 'member'
  id: string
  name: string
  email: string | null
  active: boolean
  allowEmail: boolean
  /** Vínculo ativo, dono ou gerente, com a preferência de avisos de toda a loja ligada (vale para as linhas de observador). */
  watchesAll: boolean
}

export type LoadedNotification = {
  id: string
  businessId: string
  kind: NotificationKind
  channel: NotificationChannel
  scheduledFor: Date
  attempts: number
  payload: LoadedPayload
  business: {
    status: BusinessStatus
    name: string
    color: string
    timeZone: string
    terms: { professional: string; customer: string }
    changeWindowMin: number
    enabled: NotificationSettings
  }
  appointment: LoadedAppointment | null
  recipient: LoadedRecipient | null
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** O `payload` só serve para comparar (início do aviso, motivo): nunca carrega dado pessoal. */
export function parsePayload(raw: unknown): LoadedPayload {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { startsAt: text(o['startsAt']), previousStartsAt: text(o['previousStartsAt']), reason: text(o['reason']), audience: text(o['audience']) }
}

async function loadRecipient(
  n: { businessId: string; customerId: string | null; membershipId: string | null },
): Promise<LoadedRecipient | null> {
  const { businessId } = n
  if (n.customerId) {
    const c = await prisma.customer.findFirst({
      where: { id: n.customerId, businessId },
      select: { id: true, name: true, email: true, archivedAt: true, anonymizedAt: true, notifyEmailAppointments: true },
    })
    if (!c) return null
    return {
      kind: 'customer',
      id: c.id,
      name: c.name,
      email: c.email,
      active: c.archivedAt === null && c.anonymizedAt === null,
      allowEmail: c.notifyEmailAppointments,
      watchesAll: false,
    }
  }
  if (n.membershipId) {
    const m = await prisma.membership.findFirst({
      where: { id: n.membershipId, businessId },
      select: { id: true, active: true, role: true, notifyAllAppointments: true, user: { select: { name: true, email: true } } },
    })
    if (!m) return null
    return {
      kind: 'member',
      id: m.id,
      name: m.user.name,
      email: m.user.email,
      active: m.active,
      allowEmail: true,
      watchesAll: m.active && (m.role === 'OWNER' || m.role === 'MANAGER') && m.notifyAllAppointments,
    }
  }
  return null
}

/** Recarrega a linha reservada e tudo de que a decisão e o texto dependem. `null` se a linha ou a conta sumiram. */
export async function loadNotification(id: string, businessId: string): Promise<LoadedNotification | null> {
  const n = await prisma.notification.findFirst({
    where: { id, businessId },
    select: {
      id: true, businessId: true, kind: true, channel: true, scheduledFor: true, attempts: true, payload: true,
      customerId: true, membershipId: true, appointmentId: true,
    },
  })
  if (!n) return null
  const b = await prisma.business.findFirst({
    where: { id: businessId },
    select: {
      name: true,
      timezone: true,
      status: true,
      branding: { select: { displayName: true, primaryColor: true } },
      settings: {
        select: { termProfessionalSingular: true, termCustomerSingular: true, customerChangeWindowMin: true, notifications: true },
      },
    },
  })
  if (!b) return null
  const a = n.appointmentId
    ? await prisma.appointment.findFirst({
        where: { id: n.appointmentId, businessId },
        select: {
          id: true, status: true, startsAt: true, endsAt: true, totalCents: true, cancelReason: true,
          customer: { select: { name: true } },
          professional: { select: { name: true, membershipId: true } },
          items: { select: { name: true }, orderBy: { position: 'asc' } },
        },
      })
    : null
  return {
    id: n.id,
    businessId: n.businessId,
    kind: n.kind,
    channel: n.channel,
    scheduledFor: n.scheduledFor,
    attempts: n.attempts,
    payload: parsePayload(n.payload),
    business: {
      status: b.status,
      name: b.branding?.displayName || b.name,
      color: b.branding?.primaryColor ?? '',
      timeZone: b.timezone,
      terms: {
        professional: b.settings?.termProfessionalSingular ?? 'Profissional',
        customer: b.settings?.termCustomerSingular ?? 'Cliente',
      },
      changeWindowMin: b.settings?.customerChangeWindowMin ?? 0,
      enabled: resolveNotificationSettings(b.settings?.notifications),
    },
    appointment: a
      ? {
          id: a.id,
          status: a.status,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
          totalCents: a.totalCents,
          cancelReason: a.cancelReason,
          customerName: a.customer.name,
          professionalName: a.professional.name,
          professionalMembershipId: a.professional.membershipId,
          services: a.items.map((i) => i.name),
        }
      : null,
    recipient: await loadRecipient(n),
  }
}
