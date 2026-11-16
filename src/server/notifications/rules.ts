import type { NotificationKind } from '@/server/db/generated/client'
import { toIsoInstant } from '@/server/time'
import type { LoadedAppointment, LoadedNotification } from './load'

export type Decision = { action: 'send' } | { action: 'skip'; reason: string }

const SEND: Decision = { action: 'send' }
const skip = (reason: string): Decision => ({ action: 'skip', reason })

/** Tolerância do lembrete: passado disso, o lembrete já não ajuda e é descartado. */
const REMINDER_LATE_MIN = 30

const REMINDERS: readonly NotificationKind[] = ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H']
/** Concluído e cancelado são os únicos que valem depois do atendimento; passado disso de atraso, deixam de valer. */
const CLOSING_LATE_MIN = 24 * 60

/** Avisos que fazem sentido depois do fim do atendimento. */
const AFTER_END_OK: readonly NotificationKind[] = ['APPOINTMENT_COMPLETED', 'APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_CANCELED']

const active = (a: LoadedAppointment) => a.status === 'PENDING' || a.status === 'CONFIRMED'

/** O aviso ainda descreve a situação atual do agendamento? */
function stillValid(n: LoadedNotification, a: LoadedAppointment, now: Date): boolean {
  const sameStart = n.payload.startsAt === toIsoInstant(a.startsAt)
  const recipientIsProfessional = n.recipient?.id === a.professionalMembershipId
  switch (n.kind) {
    case 'APPOINTMENT_REQUESTED':
      return a.status === 'PENDING'
    case 'APPOINTMENT_CONFIRMED':
      return a.status === 'CONFIRMED'
    case 'APPOINTMENT_REMINDER_24H':
    case 'APPOINTMENT_REMINDER_1H':
      return a.status === 'CONFIRMED' && (n.payload.startsAt === null || sameStart)
    case 'APPOINTMENT_RESCHEDULED':
      return active(a) && sameStart
    case 'STAFF_APPOINTMENT_RESCHEDULED':
      return active(a) && sameStart && recipientIsProfessional
    case 'STAFF_NEW_APPOINTMENT':
      return active(a) && recipientIsProfessional
    case 'APPOINTMENT_CANCELED':
      return a.status === 'CANCELED'
    case 'STAFF_APPOINTMENT_CANCELED':
      // Troca de profissional: o agendamento segue ativo, mas já não é deste profissional.
      return n.payload.reason === 'moved' ? active(a) && !recipientIsProfessional : a.status === 'CANCELED'
    case 'APPOINTMENT_COMPLETED':
      return a.status === 'COMPLETED'
    case 'PROFESSIONAL_FREE_EARLY':
      return a.status === 'CONFIRMED' && a.startsAt.getTime() > now.getTime()
  }
}

/**
 * Decide, sobre os dados recarregados do banco, se o aviso sai. Pura: sem banco e sem relógio global.
 * A ordem importa só para o motivo registrado: conta, tipo desligado, destinatário, situação do agendamento, passado, atraso.
 */
export function decide(n: LoadedNotification, now: Date): Decision {
  if (n.business.status !== 'ACTIVE') return skip('business_inactive')
  const toggle = n.business.enabled[n.kind]
  if (n.channel === 'EMAIL' ? !toggle.email : !toggle.push) return skip('disabled_by_business')

  const r = n.recipient
  if (!r || !r.active) return skip('recipient_gone')
  if (n.channel === 'EMAIL') {
    if (!r.allowEmail) return skip('disabled_by_recipient')
    if (!r.email) return skip('no_email')
  } else {
    if (!r.allowPush) return skip('disabled_by_recipient')
    if (r.pushTokens.length === 0) return skip('no_device')
  }

  const a = n.appointment
  if (!a || !stillValid(n, a, now)) return skip('stale')
  if (!AFTER_END_OK.includes(n.kind) && a.endsAt.getTime() <= now.getTime()) return skip('past')
  if (REMINDERS.includes(n.kind) && now.getTime() - n.scheduledFor.getTime() > REMINDER_LATE_MIN * 60_000) return skip('late')
  if (AFTER_END_OK.includes(n.kind) && now.getTime() - n.scheduledFor.getTime() > CLOSING_LATE_MIN * 60_000) return skip('late')
  return SEND
}
