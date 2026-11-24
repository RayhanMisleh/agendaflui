import { describe, expect, test } from 'vitest'
import { buildCalendarEvent, calendarEventId, formatEventTitle, isCalendarVisible } from '@/server/calendar/event'
import type { CalendarAppointment } from '@/server/calendar/event'

const ID = '0f3c2a9e-7b1d-4c8e-9a52-3d6e1f0b8c47'
const URL = 'https://app.exemplo.test/painel/agenda?data=2026-11-26&ag=' + ID

function agendamento(o: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: ID,
    status: 'CONFIRMED',
    startsAt: new Date('2026-11-26T17:00:00.000Z'),
    endsAt: new Date('2026-11-26T18:00:00.000Z'),
    customerName: 'Marina Souza',
    customerNote: null,
    petLabel: null,
    serviceNames: ['Banho'],
    ...o,
  }
}

const montar = (a: CalendarAppointment) => buildCalendarEvent(a, { timeZone: 'America/Sao_Paulo', painelUrl: URL })

describe('título do evento', () => {
  test('título "Banho · Rex (Cão médio)" e "Banho + Hidratação · Mia (Gato)"', () => {
    expect(formatEventTitle({ services: ['Banho'], customerName: 'Marina', petLabel: 'Rex (Cão médio)' })).toBe('Banho · Rex (Cão médio)')
    expect(formatEventTitle({ services: ['Banho', 'Hidratação'], customerName: 'Marina', petLabel: 'Mia (Gato)' })).toBe('Banho + Hidratação · Mia (Gato)')
    expect(montar(agendamento({ petLabel: 'Rex (Cão médio)' })).summary).toBe('Banho · Rex (Cão médio)')
  })

  test('sem pet: "Banho · Marina Souza"; título longo termina em "…" com 200 caracteres', () => {
    expect(montar(agendamento()).summary).toBe('Banho · Marina Souza')
    const longo = formatEventTitle({ services: ['S'.repeat(300)], customerName: 'Marina' })
    expect(longo).toHaveLength(200)
    expect(longo.endsWith('…')).toBe(true)
  })
})

describe('descrição e horário', () => {
  test('descrição: cliente, observação, "Aguardando confirmação." para PENDING e "Abrir no painel: <url>"', () => {
    const pendente = montar(agendamento({ status: 'PENDING', customerNote: 'Tem medo de secador' })).description
    expect(pendente.split('\n')).toEqual(['Cliente: Marina Souza', 'Observação do cliente: Tem medo de secador', 'Aguardando confirmação.', `Abrir no painel: ${URL}`])
    const confirmado = montar(agendamento()).description
    expect(confirmado).not.toContain('Aguardando confirmação.')
    expect(confirmado).not.toContain('Observação')
    expect(confirmado).toContain(`Abrir no painel: ${URL}`)
  })

  test('horário no fuso da conta com deslocamento e timeZone America/Sao_Paulo', () => {
    const e = montar(agendamento())
    expect(e.start).toEqual({ dateTime: '2026-11-26T14:00:00-03:00', timeZone: 'America/Sao_Paulo' })
    expect(e.end).toEqual({ dateTime: '2026-11-26T15:00:00-03:00', timeZone: 'America/Sao_Paulo' })
    const leste = buildCalendarEvent(agendamento(), { timeZone: 'Asia/Kolkata', painelUrl: URL })
    expect(leste.start.dateTime).toBe('2026-11-26T22:30:00+05:30')
  })
})

describe('identidade do evento', () => {
  test('id determinístico: af + 32 hex, só caracteres base32hex, igual para o mesmo agendamento', () => {
    const id = calendarEventId(ID)
    expect(id).toBe('af0f3c2a9e7b1d4c8e9a523d6e1f0b8c47')
    expect(id).toMatch(/^af[0-9a-f]{32}$/)
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/)
    expect(calendarEventId(ID.toUpperCase())).toBe(id)
    expect(montar(agendamento()).id).toBe(id)
  })

  test('extendedProperties.private.agendafluiAppointmentId é o id', () => {
    expect(montar(agendamento()).extendedProperties.private.agendafluiAppointmentId).toBe(ID)
  })

  test('só pendente, confirmado e concluído aparecem na agenda', () => {
    expect(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW'].map((s) => isCalendarVisible(s as never))).toEqual([true, true, true, false, false])
  })
})
