import type { NotificationKind } from '@/server/db/generated/client'
import { formatBrl, renderNotification } from '@/server/notifications/render'
import { INICIO, loaded } from '../setup/notification'

const KINDS: NotificationKind[] = [
  'APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELED', 'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H', 'APPOINTMENT_COMPLETED', 'PROFESSIONAL_FREE_EARLY',
  'STAFF_NEW_APPOINTMENT', 'STAFF_APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_RESCHEDULED',
]
const STAFF = new Set<NotificationKind>(['STAFF_NEW_APPOINTMENT', 'STAFF_APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_RESCHEDULED'])

function one(kind: NotificationKind) {
  const staff = STAFF.has(kind)
  return loaded({
    kind,
    ...(staff ? { recipient: { kind: 'member' as const, id: 'm-1' } } : {}),
    appointment: { status: kind === 'APPOINTMENT_CANCELED' || kind === 'STAFF_APPOINTMENT_CANCELED' ? 'CANCELED' : 'CONFIRMED' },
    payload: { startsAt: INICIO.toISOString(), previousStartsAt: '2026-11-15T19:00:00.000Z', reason: null },
  })
}

describe('renderNotification', () => {
  test.each(KINDS)('%s: assunto, texto, HTML e push sem sobras de modelo, na hora de Manaus', (kind) => {
    const r = renderNotification(one(kind))
    for (const t of [r.email.subject, r.email.text, r.email.html, r.push.title, r.push.body]) {
      expect(t).not.toContain('undefined')
      expect(t).not.toContain('null')
      expect(t).not.toMatch(/\{|\}/)
    }
    expect(r.email.subject.length).toBeGreaterThan(5)
    expect(r.email.subject).not.toMatch(/[\r\n]/)
    expect(r.email.text).toContain('Tosa & Cia')
    expect(r.email.text).toMatch(/16\/11\/2026|15\/11\/2026/)
    expect(r.email.text).toContain('15:00')
    expect(r.email.text).not.toContain('19:00')
    expect(r.email.html).toContain('lang="pt-BR"')
    expect(r.email.html).not.toMatch(/<img|https?:\/\//)
    expect(r.push.data['kind']).toBe(kind)
    expect(r.push.data['appointmentId']).toBe('a-1')
  })

  test('confirmado: serviços, profissional com o termo da conta, total em reais, prazo e nome do negócio', () => {
    const r = renderNotification(one('APPOINTMENT_CONFIRMED'))
    expect(r.email.subject).toBe('Agendamento confirmado: Banho e Tosa em 16/11/2026 às 15:00')
    expect(r.email.text).toContain('Tosador: Ana')
    expect(r.email.text).toContain('Banho')
    expect(r.email.text).toContain('R$ 123,45')
    // 15:00 menos o prazo de 120 min
    expect(r.email.text).toContain('13:00')
    expect(r.email.text).toContain('Olá, Maria Souza.')
  })

  test('pendente de aprovação: avisa que o negócio ainda vai confirmar', () => {
    const r = renderNotification(one('APPOINTMENT_REQUESTED'))
    expect(r.email.subject).toMatch(/^Pedido de agendamento recebido/)
    expect(r.email.text).toMatch(/confirm/i)
  })

  test('a equipe fala do cliente com o termo da conta', () => {
    const r = renderNotification(one('STAFF_NEW_APPOINTMENT'))
    expect(r.email.text).toContain('Tutor: Maria Souza')
    expect(r.email.subject).toMatch(/Novo agendamento/)
  })

  test('cancelamento pela equipe inclui o motivo', () => {
    const n = loaded({ kind: 'APPOINTMENT_CANCELED', appointment: { status: 'CANCELED', cancelReason: 'Profissional doente' } })
    const r = renderNotification(n)
    expect(r.email.text).toContain('Motivo: Profissional doente')
    expect(r.email.html).toContain('Profissional doente')
    expect(r.push.body).toContain('Profissional doente')
  })

  test('cancelamento sem motivo não menciona motivo', () => {
    const r = renderNotification(loaded({ kind: 'APPOINTMENT_CANCELED', appointment: { status: 'CANCELED' } }))
    expect(r.email.text).not.toContain('Motivo')
  })

  test('troca de profissional: texto próprio para o profissional antigo', () => {
    const n = loaded({
      kind: 'STAFF_APPOINTMENT_CANCELED',
      recipient: { kind: 'member', id: 'm-old' },
      payload: { startsAt: INICIO.toISOString(), previousStartsAt: null, reason: 'moved' },
    })
    const r = renderNotification(n)
    expect(r.email.subject).toMatch(/passou para outro|transferido/i)
    expect(r.email.text).not.toMatch(/cancelou/i)
    expect(r.email.text).toContain('para outro Tosador')
    expect(r.email.subject).toContain('outro Tosador')
  })

  test('remarcação mostra o horário anterior quando o payload o traz', () => {
    const r = renderNotification(one('APPOINTMENT_RESCHEDULED'))
    expect(r.email.text).toContain('15/11/2026 15:00')
  })

  test('escapa HTML de nome da conta, cliente, profissional, serviço e motivo; texto puro fica literal', () => {
    const x = '<script>alert(1)</script>'
    const n = loaded({
      kind: 'APPOINTMENT_CANCELED',
      business: { name: `Tosa ${x}` },
      recipient: { name: x },
      appointment: { status: 'CANCELED', professionalName: x, customerName: x, services: [x], cancelReason: x },
    })
    const r = renderNotification(n)
    expect(r.email.html).not.toContain('<script>')
    expect(r.email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(r.email.text).toContain(x)
  })

  test('assunto nunca leva quebra de linha, mesmo com nomes maliciosos', () => {
    const n = loaded({ business: { name: 'A\r\nBcc: x@y.z' }, appointment: { services: ['Ba\nnho'] } })
    expect(renderNotification(n).email.subject).not.toMatch(/[\r\n]/)
  })

  test('sem agendamento carregado não há o que escrever', () => {
    expect(() => renderNotification(loaded({ appointment: null }))).toThrow()
  })
})

describe('formatBrl', () => {
  test.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 0,05'],
    [5000, 'R$ 50,00'],
    [123456, 'R$ 1.234,56'],
    [100000000, 'R$ 1.000.000,00'],
  ])('%i centavos', (c, txt) => expect(formatBrl(c)).toBe(txt))
})
