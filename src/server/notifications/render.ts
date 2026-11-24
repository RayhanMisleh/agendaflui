import type { NotificationKind } from '@/server/db/generated/client'
import { addMinutes, formatDate, formatDateTime, formatTime, fromIsoInstant } from '@/server/time'
import { emailFrame, limpo, type FrameContent } from './frame'
import type { LoadedAppointment, LoadedNotification } from './load'
import type { EmailMessage } from './channels/types'

export type RenderedNotification = {
  email: Omit<EmailMessage, 'to' | 'fromName'>
}

/** Centavos inteiros em reais, sem `toLocaleString` (proibido fora do módulo de tempo): `R$ 1.234,56`. */
export function formatBrl(cents: number): string {
  if (!Number.isInteger(cents)) throw new RangeError('Valor em centavos deve ser inteiro.')
  const abs = Math.abs(cents)
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cents < 0 ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`
}

/** "A", "A e B", "A, B e C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

function instantOf(text: string | null, fallback: Date): Date {
  if (text === null) return fallback
  try {
    return fromIsoInstant(text)
  } catch {
    return fallback
  }
}

type Parts = { title: string; subject: string; content: FrameContent }

const STAFF_KINDS: readonly NotificationKind[] = ['STAFF_NEW_APPOINTMENT', 'STAFF_APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_RESCHEDULED']

function build(n: LoadedNotification, a: LoadedAppointment): Parts {
  const tz = n.business.timeZone
  const biz = limpo(n.business.name)
  const moved = n.kind === 'STAFF_APPOINTMENT_CANCELED' && n.payload.reason === 'moved'
  // O aviso de troca de profissional fala do horário antigo (o do payload), não do atual.
  const startsAt = moved ? instantOf(n.payload.startsAt, a.startsAt) : a.startsAt
  const date = formatDate(startsAt, tz)
  const time = formatTime(startsAt, tz)
  const services = joinNames(a.services.map(limpo))
  const customer = limpo(a.customerName)
  const professional = `Profissional: ${limpo(a.professionalName)}`
  const reason = a.cancelReason ? limpo(a.cancelReason) : ''
  const hello = `Olá, ${limpo(n.recipient?.name ?? '')}.`
  const previous = n.payload.previousStartsAt ? instantOf(n.payload.previousStartsAt, startsAt) : null

  const details: [string, string][] = [
    ['Serviços', services],
    ['Data e hora', `${date} às ${time}`],
    ...(STAFF_KINDS.includes(n.kind) ? ([['Cliente', customer]] as [string, string][]) : ([['Profissional', limpo(a.professionalName)]] as [string, string][])),
    // Quem recebe os avisos de toda a loja precisa saber de quem é o atendimento (o próprio profissional já sabe).
    ...(n.payload.audience === 'watcher' ? ([['Profissional', limpo(a.professionalName)]] as [string, string][]) : []),
    ['Total', formatBrl(a.totalCents)],
  ]
  const detailsPrevious: [string, string][] = previous ? [['Horário anterior', formatDateTime(previous, tz)], ...details] : details

  const deadline = (): string => {
    if (n.business.changeWindowMin <= 0) return ''
    const limit = addMinutes(a.startsAt, -n.business.changeWindowMin)
    return limit.getTime() > n.scheduledFor.getTime()
      ? `Você pode cancelar ou remarcar pelo link da loja até ${formatDateTime(limit, tz)}.`
      : `O prazo para cancelar ou remarcar pelo link da loja já passou. Se precisar mudar, fale com ${biz}.`
  }
  const paragraphs = (...lines: string[]) => lines.filter((l) => l !== '')
  const reasonLine = reason ? `Motivo: ${reason}` : ''
  const when = `${date} às ${time}`

  switch (n.kind) {
    case 'APPOINTMENT_REQUESTED':
      return {
        title: 'Pedido de agendamento recebido',
        subject: `Pedido de agendamento recebido: ${services} em ${when}`,
        content: { paragraphs: paragraphs(hello, `Recebemos o seu pedido em ${biz}. Ainda vamos confirmar o horário e avisamos assim que isso acontecer.`, deadline()), rows: details },
      }
    case 'APPOINTMENT_CONFIRMED':
      return {
        title: 'Agendamento confirmado',
        subject: `Agendamento confirmado: ${services} em ${when}`,
        content: { paragraphs: paragraphs(hello, `Seu agendamento em ${biz} está confirmado.`, deadline()), rows: details },
      }
    case 'APPOINTMENT_CANCELED':
      return {
        title: 'Agendamento cancelado',
        subject: `Agendamento cancelado: ${services} em ${when}`,
        content: { paragraphs: paragraphs(hello, `${biz} cancelou o seu agendamento.`, reasonLine, 'Se quiser, marque outro horário pelo link da loja.'), rows: details },
      }
    case 'APPOINTMENT_RESCHEDULED':
      return {
        title: 'Agendamento remarcado',
        subject: `Agendamento remarcado: ${services} para ${when}`,
        content: { paragraphs: paragraphs(hello, `${biz} mudou o horário do seu agendamento.`, deadline()), rows: detailsPrevious },
      }
    case 'APPOINTMENT_REMINDER_24H':
    case 'APPOINTMENT_REMINDER_1H':
      return {
        title: 'Lembrete do seu agendamento',
        subject: `Lembrete: ${services} em ${when}`,
        content: { paragraphs: paragraphs(hello, `Seu agendamento em ${biz} é ${n.kind === 'APPOINTMENT_REMINDER_1H' ? 'daqui a pouco' : 'em breve'}.`), rows: details },
      }
    case 'APPOINTMENT_COMPLETED':
      return {
        title: 'Atendimento concluído',
        subject: `Atendimento concluído: ${services}`,
        content: { paragraphs: paragraphs(hello, `Seu atendimento em ${biz} foi concluído. Obrigado por vir!`), rows: details },
      }
    case 'PROFESSIONAL_FREE_EARLY':
      return {
        title: 'Dá para vir mais cedo',
        subject: `${limpo(a.professionalName)} já está livre: venha mais cedo`,
        content: { paragraphs: paragraphs(hello, `${professional} já está livre e pode atender você antes do horário marcado. Se puder, venha mais cedo.`), rows: details },
      }
    case 'STAFF_NEW_APPOINTMENT':
      return {
        title: 'Novo agendamento',
        subject: `Novo agendamento: ${customer} em ${when}`,
        content: { paragraphs: paragraphs(hello, 'Há um novo agendamento na sua agenda.'), rows: details },
      }
    case 'STAFF_APPOINTMENT_CANCELED':
      return moved
        ? {
            title: 'O horário passou para outro Profissional',
            subject: `Agendamento passou para outro Profissional: ${customer} em ${when}`,
            content: { paragraphs: paragraphs(hello, 'Este horário passou para outro Profissional e saiu da sua agenda.'), rows: details },
          }
        : {
            title: 'Agendamento cancelado',
            subject: `Agendamento cancelado: ${customer} em ${when}`,
            content: { paragraphs: paragraphs(hello, 'Um agendamento da sua agenda foi cancelado.', reasonLine), rows: details },
          }
    case 'STAFF_APPOINTMENT_RESCHEDULED':
      return {
        title: 'Agendamento remarcado',
        subject: `Agendamento remarcado: ${customer} para ${when}`,
        content: { paragraphs: paragraphs(hello, 'Um agendamento da sua agenda mudou de horário.'), rows: detailsPrevious },
      }
  }
}

/** Assunto e e-mail (HTML e texto puro) de um aviso já carregado. Pura. O que for dado é escapado no HTML. */
export function renderNotification(n: LoadedNotification): RenderedNotification {
  if (!n.appointment) throw new Error('Aviso sem agendamento carregado.')
  const p = build(n, n.appointment)
  const { text, html } = emailFrame({ name: n.business.name, color: n.business.color }, p.title, p.content)
  return { email: { subject: limpo(p.subject), text, html } }
}
