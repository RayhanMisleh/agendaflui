import type { AppointmentStatus, PetSize, PetSpecies } from '@/server/db/generated/client'
import { variantDef, variantOfPet } from '@/server/niches'
import { fromIsoInstant, localParts } from '@/server/time'

/*
 * O evento do Google Agenda a partir de um agendamento: funções puras (sem banco, rede nem relógio). O id do evento é
 * determinístico (`af` + o id do agendamento sem hífens), então enviar duas vezes atualiza o mesmo evento em vez de duplicar.
 */

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

const TITLE_MAX = 200

export type CalendarAppointment = {
  id: string
  status: AppointmentStatus
  startsAt: Date
  endsAt: Date
  customerName: string
  customerNote: string | null
  /** Rótulo do pet do atendimento, como "Rex (Cão médio)"; nulo enquanto o agendamento não tem pet. */
  petLabel: string | null
  serviceNames: string[]
}

export type CalendarEventBody = {
  id: string
  status: 'confirmed'
  summary: string
  description: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  extendedProperties: { private: { agendafluiAppointmentId: string } }
  reminders: { useDefault: true }
}

/** `af` + 32 hexadecimais em minúsculas: só caracteres do alfabeto base32hex que o Google exige nos ids. */
export function calendarEventId(appointmentId: string): string {
  return `af${appointmentId.replaceAll('-', '').toLowerCase()}`
}

/** PENDING, CONFIRMED e COMPLETED viram evento; CANCELED e NO_SHOW apagam. */
export function isCalendarVisible(status: AppointmentStatus): boolean {
  return status === 'PENDING' || status === 'CONFIRMED' || status === 'COMPLETED'
}

/** "Rex (Cão médio)", "Mia (Gato)": o nome do pet e o animal e porte de hoje. */
export function petEventLabel(p: { name: string; species: PetSpecies; size: PetSize | null }): string {
  return `${p.name} (${variantDef(variantOfPet(p)).label})`
}

/** "Banho + Hidratação · Rex (Cão médio)"; sem pet, o nome do cliente. Passou de 200 caracteres, termina em "…". */
export function formatEventTitle(i: { services: string[]; customerName: string; petLabel?: string | null }): string {
  const titulo = `${i.services.join(' + ')} · ${i.petLabel ?? i.customerName}`
  return titulo.length <= TITLE_MAX ? titulo : `${titulo.slice(0, TITLE_MAX - 1).trimEnd()}…`
}

const two = (n: number): string => String(Math.abs(n)).padStart(2, '0')

/** O instante em hora local com deslocamento (`2026-11-26T14:00:00-03:00`), pelo `src/server/time`. */
function localDateTime(instant: Date, timeZone: string): string {
  const { date, time } = localParts(instant, timeZone)
  const asUtc = fromIsoInstant(`${date}T${time}:00.000Z`)
  const offsetMin = Math.round((asUtc.getTime() - instant.getTime()) / 60_000)
  const sign = offsetMin < 0 ? '-' : '+'
  return `${date}T${time}:00${sign}${two(Math.trunc(offsetMin / 60))}:${two(offsetMin % 60)}`
}

export function buildCalendarEvent(a: CalendarAppointment, o: { timeZone: string; painelUrl: string }): CalendarEventBody {
  const linhas = [`Cliente: ${a.customerName}`]
  if (a.customerNote !== null && a.customerNote.trim() !== '') linhas.push(`Observação do cliente: ${a.customerNote.trim()}`)
  if (a.status === 'PENDING') linhas.push('Aguardando confirmação.')
  linhas.push(`Abrir no painel: ${o.painelUrl}`)
  return {
    id: calendarEventId(a.id),
    status: 'confirmed',
    summary: formatEventTitle({ services: a.serviceNames, customerName: a.customerName, petLabel: a.petLabel }),
    description: linhas.join('\n'),
    start: { dateTime: localDateTime(a.startsAt, o.timeZone), timeZone: o.timeZone },
    end: { dateTime: localDateTime(a.endsAt, o.timeZone), timeZone: o.timeZone },
    extendedProperties: { private: { agendafluiAppointmentId: a.id } },
    reminders: { useDefault: true },
  }
}
