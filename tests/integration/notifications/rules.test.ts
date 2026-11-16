import { decide } from '@/server/notifications/rules'
import { fromEpochMs } from '@/server/time'
import { AGORA, INICIO, loaded } from '../../setup/notification'

const min = (d: Date, m: number) => fromEpochMs(d.getTime() + m * 60_000)
const iso = (d: Date) => d.toISOString()
const SEND = { action: 'send' } as const
const skip = (reason: string) => ({ action: 'skip', reason })

type Caso = { nome: string; n: ReturnType<typeof loaded>; esperado: ReturnType<typeof skip> | typeof SEND; now?: Date }

const desligado = (kind: string, canal: 'email' | 'push') => {
  const base = loaded()
  return { ...base.business.enabled, [kind]: { ...base.business.enabled['APPOINTMENT_CONFIRMED'], [canal]: false } }
}

const casos: Caso[] = [
  { nome: 'confirmado de agendamento confirmado e futuro envia', n: loaded(), esperado: SEND },
  { nome: 'conta suspensa', n: loaded({ business: { status: 'SUSPENDED' } }), esperado: skip('business_inactive') },
  { nome: 'conta arquivada', n: loaded({ business: { status: 'ARCHIVED' } }), esperado: skip('business_inactive') },
  { nome: 'tipo desligado para e-mail', n: loaded({ business: { enabled: desligado('APPOINTMENT_CONFIRMED', 'email') } }), esperado: skip('disabled_by_business') },
  { nome: 'tipo desligado só para push não atrapalha o e-mail', n: loaded({ business: { enabled: desligado('APPOINTMENT_CONFIRMED', 'push') } }), esperado: SEND },
  { nome: 'tipo desligado para push', n: loaded({ channel: 'PUSH', business: { enabled: desligado('APPOINTMENT_CONFIRMED', 'push') } }), esperado: skip('disabled_by_business') },
  { nome: 'destinatário apagado', n: loaded({ recipient: null }), esperado: skip('recipient_gone') },
  { nome: 'cliente arquivado ou anonimizado', n: loaded({ recipient: { active: false } }), esperado: skip('recipient_gone') },
  { nome: 'cliente desligou e-mail', n: loaded({ recipient: { allowEmail: false } }), esperado: skip('disabled_by_recipient') },
  { nome: 'cliente desligou push', n: loaded({ channel: 'PUSH', recipient: { allowPush: false } }), esperado: skip('disabled_by_recipient') },
  { nome: 'cliente desligou só push: e-mail sai', n: loaded({ recipient: { allowPush: false } }), esperado: SEND },
  { nome: 'cliente sem e-mail', n: loaded({ recipient: { email: null } }), esperado: skip('no_email') },
  { nome: 'push com dispositivo envia', n: loaded({ channel: 'PUSH' }), esperado: SEND },
  { nome: 'push sem dispositivo', n: loaded({ channel: 'PUSH', recipient: { pushTokens: [] } }), esperado: skip('no_device') },
  {
    nome: 'membro com vínculo inativo',
    n: loaded({ kind: 'STAFF_NEW_APPOINTMENT', recipient: { kind: 'member', active: false } }),
    esperado: skip('recipient_gone'),
  },
  { nome: 'membro ativo envia', n: loaded({ kind: 'STAFF_NEW_APPOINTMENT', recipient: { kind: 'member', id: 'm-1' } }), esperado: SEND },
  // situação do agendamento por tipo
  { nome: 'confirmado com agendamento cancelado', n: loaded({ appointment: { status: 'CANCELED' } }), esperado: skip('stale') },
  { nome: 'confirmado com agendamento pendente', n: loaded({ appointment: { status: 'PENDING' } }), esperado: skip('stale') },
  { nome: 'solicitado pendente envia', n: loaded({ kind: 'APPOINTMENT_REQUESTED', appointment: { status: 'PENDING' } }), esperado: SEND },
  { nome: 'solicitado já confirmado', n: loaded({ kind: 'APPOINTMENT_REQUESTED' }), esperado: skip('stale') },
  { nome: 'agendamento apagado', n: loaded({ appointment: null }), esperado: skip('stale') },
  {
    nome: 'cancelado só se cancelado',
    n: loaded({ kind: 'APPOINTMENT_CANCELED', appointment: { status: 'CANCELED' } }),
    esperado: SEND,
  },
  { nome: 'cancelado com agendamento ativo', n: loaded({ kind: 'APPOINTMENT_CANCELED' }), esperado: skip('stale') },
  {
    nome: 'cancelado de agendamento que já passou ainda envia',
    n: loaded({ kind: 'APPOINTMENT_CANCELED', appointment: { status: 'CANCELED', startsAt: min(AGORA, -300), endsAt: min(AGORA, -240) } }),
    esperado: SEND,
  },
  {
    nome: 'concluído só se concluído (mesmo já passado)',
    n: loaded({ kind: 'APPOINTMENT_COMPLETED', appointment: { status: 'COMPLETED', startsAt: min(AGORA, -300), endsAt: min(AGORA, -240) } }),
    esperado: SEND,
  },
  { nome: 'concluído com agendamento confirmado', n: loaded({ kind: 'APPOINTMENT_COMPLETED' }), esperado: skip('stale') },
  {
    nome: 'remarcado com o mesmo início envia',
    n: loaded({ kind: 'APPOINTMENT_RESCHEDULED', payload: { startsAt: iso(INICIO), previousStartsAt: null, reason: null } }),
    esperado: SEND,
  },
  {
    nome: 'remarcado de novo depois (início do payload não é o atual)',
    n: loaded({ kind: 'APPOINTMENT_RESCHEDULED', payload: { startsAt: iso(min(INICIO, -60)), previousStartsAt: null, reason: null } }),
    esperado: skip('stale'),
  },
  {
    nome: 'remarcado sem início no payload',
    n: loaded({ kind: 'APPOINTMENT_RESCHEDULED', payload: { startsAt: null, previousStartsAt: null, reason: null } }),
    esperado: skip('stale'),
  },
  {
    nome: 'remarcado de agendamento cancelado',
    n: loaded({ kind: 'APPOINTMENT_RESCHEDULED', appointment: { status: 'CANCELED' } }),
    esperado: skip('stale'),
  },
  {
    nome: 'remarcação para a equipe: início atual envia',
    n: loaded({ kind: 'STAFF_APPOINTMENT_RESCHEDULED', recipient: { kind: 'member', id: 'm-1' } }),
    esperado: SEND,
  },
  {
    nome: 'remarcação para a equipe: início desatualizado',
    n: loaded({
      kind: 'STAFF_APPOINTMENT_RESCHEDULED',
      recipient: { kind: 'member', id: 'm-1' },
      payload: { startsAt: iso(min(INICIO, 30)), previousStartsAt: null, reason: null },
    }),
    esperado: skip('stale'),
  },
  {
    nome: 'remarcação para a equipe: profissional trocou e o vínculo não é mais o dele',
    n: loaded({ kind: 'STAFF_APPOINTMENT_RESCHEDULED', recipient: { kind: 'member', id: 'm-2' } }),
    esperado: skip('stale'),
  },
  {
    nome: 'cancelamento para a equipe: agendamento cancelado envia',
    n: loaded({ kind: 'STAFF_APPOINTMENT_CANCELED', recipient: { kind: 'member', id: 'm-1' }, appointment: { status: 'CANCELED' } }),
    esperado: SEND,
  },
  {
    nome: 'cancelamento para a equipe com agendamento ativo e sem motivo "moved"',
    n: loaded({ kind: 'STAFF_APPOINTMENT_CANCELED', recipient: { kind: 'member', id: 'm-1' } }),
    esperado: skip('stale'),
  },
  {
    nome: 'troca de profissional: aviso ao antigo sai com o agendamento ativo e outro profissional',
    n: loaded({
      kind: 'STAFF_APPOINTMENT_CANCELED',
      recipient: { kind: 'member', id: 'm-old' },
      payload: { startsAt: iso(INICIO), previousStartsAt: null, reason: 'moved' },
    }),
    esperado: SEND,
  },
  {
    nome: 'troca de profissional: o agendamento voltou para o antigo',
    n: loaded({
      kind: 'STAFF_APPOINTMENT_CANCELED',
      recipient: { kind: 'member', id: 'm-1' },
      payload: { startsAt: iso(INICIO), previousStartsAt: null, reason: 'moved' },
    }),
    esperado: skip('stale'),
  },
  {
    nome: 'novo agendamento para a equipe envia com agendamento ativo',
    n: loaded({ kind: 'STAFF_NEW_APPOINTMENT', recipient: { kind: 'member', id: 'm-1' }, appointment: { status: 'PENDING' } }),
    esperado: SEND,
  },
  {
    nome: 'novo agendamento para a equipe com agendamento cancelado',
    n: loaded({ kind: 'STAFF_NEW_APPOINTMENT', recipient: { kind: 'member', id: 'm-1' }, appointment: { status: 'CANCELED' } }),
    esperado: skip('stale'),
  },
  {
    nome: 'livre mais cedo: confirmado e não iniciado',
    n: loaded({ kind: 'PROFESSIONAL_FREE_EARLY' }),
    esperado: SEND,
  },
  {
    nome: 'livre mais cedo: já iniciou',
    n: loaded({ kind: 'PROFESSIONAL_FREE_EARLY', appointment: { startsAt: min(AGORA, -10), endsAt: min(AGORA, 50) } }),
    esperado: skip('stale'),
  },
  {
    nome: 'livre mais cedo: agendamento pendente',
    n: loaded({ kind: 'PROFESSIONAL_FREE_EARLY', appointment: { status: 'PENDING' } }),
    esperado: skip('stale'),
  },
  // concluído e cancelado: atraso de mais de 24 h em relação ao horário previsto
  {
    nome: 'concluído com exatamente 24 h de atraso ainda envia',
    n: loaded({ kind: 'APPOINTMENT_COMPLETED', scheduledFor: min(AGORA, -1440), appointment: { status: 'COMPLETED', startsAt: min(AGORA, -1600), endsAt: min(AGORA, -1540) } }),
    esperado: SEND,
  },
  {
    nome: 'concluído com mais de 24 h de atraso',
    n: loaded({ kind: 'APPOINTMENT_COMPLETED', scheduledFor: min(AGORA, -1441), appointment: { status: 'COMPLETED', startsAt: min(AGORA, -1600), endsAt: min(AGORA, -1540) } }),
    esperado: skip('late'),
  },
  {
    nome: 'cancelado com mais de 24 h de atraso',
    n: loaded({ kind: 'APPOINTMENT_CANCELED', scheduledFor: min(AGORA, -1441), appointment: { status: 'CANCELED' } }),
    esperado: skip('late'),
  },
  {
    nome: 'cancelamento para a equipe com mais de 24 h de atraso',
    n: loaded({ kind: 'STAFF_APPOINTMENT_CANCELED', recipient: { kind: 'member', id: 'm-1' }, scheduledFor: min(AGORA, -1441), appointment: { status: 'CANCELED' } }),
    esperado: skip('late'),
  },
  // passado e atraso
  {
    nome: 'agendamento que já terminou',
    n: loaded({ appointment: { startsAt: min(AGORA, -120), endsAt: min(AGORA, -60) } }),
    esperado: skip('past'),
  },
  {
    nome: 'lembrete dentro da tolerância de 30 minutos envia',
    n: loaded({ kind: 'APPOINTMENT_REMINDER_1H', scheduledFor: min(AGORA, -30), payload: { startsAt: iso(INICIO), previousStartsAt: null, reason: null } }),
    esperado: SEND,
  },
  {
    nome: 'lembrete com mais de 30 minutos de atraso',
    n: loaded({ kind: 'APPOINTMENT_REMINDER_1H', scheduledFor: min(AGORA, -31) }),
    esperado: skip('late'),
  },
  { nome: 'lembrete de agendamento cancelado', n: loaded({ kind: 'APPOINTMENT_REMINDER_24H', appointment: { status: 'CANCELED' } }), esperado: skip('stale') },
  {
    nome: 'lembrete de um horário que mudou',
    n: loaded({ kind: 'APPOINTMENT_REMINDER_24H', payload: { startsAt: iso(min(INICIO, 90)), previousStartsAt: null, reason: null } }),
    esperado: skip('stale'),
  },
  {
    nome: 'aviso confirmado com atraso grande mas atendimento futuro ainda envia (só lembrete tem tolerância)',
    n: loaded({ scheduledFor: min(AGORA, -600) }),
    esperado: SEND,
  },
]

describe('decide', () => {
  test.each(casos)('$nome', ({ n, esperado, now }) => {
    expect(decide(n, now ?? AGORA)).toEqual(esperado)
  })

  test('as cinco situações do Review Focus: cancelado, sem e-mail, membro desativado, lembrete atrasado, canal desligado pelo cliente', () => {
    expect(decide(loaded({ appointment: { status: 'CANCELED' } }), AGORA)).toEqual(skip('stale'))
    expect(decide(loaded({ recipient: { email: null } }), AGORA)).toEqual(skip('no_email'))
    expect(decide(loaded({ kind: 'STAFF_NEW_APPOINTMENT', recipient: { kind: 'member', active: false } }), AGORA)).toEqual(skip('recipient_gone'))
    expect(decide(loaded({ kind: 'APPOINTMENT_REMINDER_1H', scheduledFor: min(AGORA, -45) }), AGORA)).toEqual(skip('late'))
    expect(decide(loaded({ recipient: { allowEmail: false } }), AGORA)).toEqual(skip('disabled_by_recipient'))
  })

  test('a decisão não muda o aviso carregado', () => {
    const n = loaded()
    const copia = structuredClone(n)
    decide(n, AGORA)
    expect(n).toEqual(copia)
  })
})
