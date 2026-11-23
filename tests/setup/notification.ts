import type { LoadedNotification } from '@/server/notifications/load'
import { fromEpochMs } from '@/server/time'

/** Segunda-feira, 12:00 em Manaus (16:00 UTC). */
export const AGORA = new Date('2026-11-16T16:00:00Z')
/** Início do atendimento padrão dos casos: 15:00 em Manaus, 3 h depois de AGORA. */
export const INICIO = new Date('2026-11-16T19:00:00Z')

type Overrides = Partial<Omit<LoadedNotification, 'business' | 'appointment' | 'recipient'>> & {
  business?: Partial<LoadedNotification['business']>
  appointment?: Partial<NonNullable<LoadedNotification['appointment']>> | null
  recipient?: Partial<NonNullable<LoadedNotification['recipient']>> | null
}

/** Aviso carregado "feliz": confirmado, cliente com e-mail, atendimento daqui a 3 h na conta de Manaus. */
export function loaded(o: Overrides = {}): LoadedNotification {
  const { business, appointment, recipient, ...rest } = o
  const base: LoadedNotification = {
    id: 'n-1',
    businessId: 'b-1',
    kind: 'APPOINTMENT_CONFIRMED',
    channel: 'EMAIL',
    scheduledFor: AGORA,
    attempts: 0,
    payload: { startsAt: INICIO.toISOString(), previousStartsAt: null, reason: null, audience: null },
    business: {
      status: 'ACTIVE',
      name: 'Tosa & Cia',
      color: '#2F6B4F',
      timeZone: 'America/Manaus',
      terms: { professional: 'Tosador', customer: 'Tutor' },
      changeWindowMin: 120,
      enabled: Object.fromEntries(
        [
          'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_REMINDER_24H',
          'APPOINTMENT_REMINDER_1H', 'APPOINTMENT_COMPLETED', 'PROFESSIONAL_FREE_EARLY', 'STAFF_NEW_APPOINTMENT',
          'STAFF_APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_RESCHEDULED', 'APPOINTMENT_REQUESTED',
        ].map((k) => [k, { email: true }]),
      ) as LoadedNotification['business']['enabled'],
    },
    appointment: {
      id: 'a-1',
      status: 'CONFIRMED',
      startsAt: INICIO,
      endsAt: fromEpochMs(INICIO.getTime() + 60 * 60_000),
      totalCents: 12345,
      cancelReason: null,
      customerName: 'Maria Souza',
      professionalName: 'Ana',
      professionalMembershipId: 'm-1',
      services: ['Banho', 'Tosa'],
    },
    recipient: {
      kind: 'customer',
      id: 'c-1',
      name: 'Maria Souza',
      email: 'maria@exemplo.test',
      active: true,
      allowEmail: true,
      watchesAll: false,
    },
  }
  return {
    ...base,
    ...rest,
    business: { ...base.business, ...business },
    appointment: appointment === null ? null : { ...base.appointment!, ...appointment },
    recipient: recipient === null ? null : { ...base.recipient!, ...recipient },
  } as LoadedNotification
}
