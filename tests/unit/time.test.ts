import { describe, expect, test } from 'vitest'
import {
  addDays,
  addMinutes,
  formatDate,
  formatDateTime,
  formatTime,
  isLocalDate,
  isLocalTime,
  isValidTimeZone,
  localDayRange,
  localParts,
  minutesBetween,
  toInstant,
  todayIn,
  weekdayOf,
} from '@/server/time'

const iso = (d: Date) => d.toISOString()

test('dia local de São Paulo', () => {
  const r = localDayRange('2026-11-13', 'America/Sao_Paulo')
  expect(iso(r.start)).toBe('2026-11-13T03:00:00.000Z')
  expect(iso(r.end)).toBe('2026-11-14T03:00:00.000Z')
})
test('dia local de Manaus', () => {
  expect(iso(localDayRange('2026-11-13', 'America/Manaus').start)).toBe('2026-11-13T04:00:00.000Z')
})
test('dia de 25 horas em Lisboa (fim do horário de verão)', () => {
  const r = localDayRange('2026-10-25', 'Europe/Lisbon')
  expect(iso(r.start)).toBe('2026-10-24T23:00:00.000Z')
  expect(iso(r.end)).toBe('2026-10-26T00:00:00.000Z')
  expect(minutesBetween(r.start, r.end)).toBe(25 * 60)
})
test('hora que não existe em Nova York avança', () => {
  expect(iso(toInstant('2026-03-08', '02:30', 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z')
})
test('hora repetida em Nova York usa a primeira', () => {
  expect(iso(toInstant('2026-11-01', '01:30', 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z')
})
test('12:30 em São Paulo é 15:30 UTC', () => {
  expect(iso(toInstant('2026-11-13', '12:30', 'America/Sao_Paulo'))).toBe('2026-11-13T15:30:00.000Z')
})
test('virada de ano: partes locais', () => {
  expect(localParts(new Date('2026-01-01T02:30:00.000Z'), 'America/Sao_Paulo')).toEqual({
    date: '2025-12-31',
    time: '23:30',
    weekday: 'WEDNESDAY',
  })
})
test('dia da semana de data pura não depende de fuso', () => {
  expect(weekdayOf('2026-11-13')).toBe('FRIDAY')
})
test('hoje depende do fuso da conta', () => {
  const now = new Date('2026-11-14T01:00:00.000Z')
  expect(todayIn('America/Sao_Paulo', now)).toBe('2026-11-13')
  expect(todayIn('Europe/Lisbon', now)).toBe('2026-11-14')
})
test('addDays atravessa mês e ano', () => {
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
})
test('formatação', () => {
  const t = new Date('2026-11-13T15:00:00.000Z')
  expect(formatDateTime(t, 'America/Sao_Paulo')).toBe('13/11/2026 12:00')
  expect(formatDate(t, 'America/Sao_Paulo')).toBe('13/11/2026')
  expect(formatTime(t, 'America/Manaus')).toBe('11:00')
})
test('validações', () => {
  expect(isValidTimeZone('America/Sao_Paulo')).toBe(true)
  expect(isValidTimeZone('Marte/Olimpo')).toBe(false)
  expect(isLocalDate('2026-02-30')).toBe(false)
  expect(isLocalTime('24:00')).toBe(false)
  expect(() => toInstant('13/11/2026', '12:30', 'America/Sao_Paulo')).toThrow(RangeError)
})

describe('casos adicionais', () => {
  test('localDayRange recusa data inexistente e fuso inválido', () => {
    expect(() => localDayRange('2026-02-30', 'America/Sao_Paulo')).toThrow(RangeError)
    expect(() => localDayRange('2026-11-13', 'Marte/Olimpo')).toThrow(RangeError)
  })

  test('toInstant recusa hora e fuso inválidos, com a entrada na mensagem', () => {
    expect(() => toInstant('2026-11-13', '24:00', 'America/Sao_Paulo')).toThrow(/24:00/)
    expect(() => toInstant('2026-11-13', '12:30', 'Marte/Olimpo')).toThrow(/Marte\/Olimpo/)
    expect(() => toInstant('2026-02-30', '12:30', 'America/Sao_Paulo')).toThrow(/2026-02-30/)
  })

  test('fuso por deslocamento fixo não vale como fuso de conta', () => {
    expect(isValidTimeZone('+03:00')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  test('localParts e toInstant são inversas', () => {
    const original = new Date('2026-07-20T14:37:29.123Z')
    const truncado = new Date('2026-07-20T14:37:00.000Z')
    for (const tz of ['America/Sao_Paulo', 'America/Manaus', 'Europe/Lisbon', 'America/New_York']) {
      const p = localParts(original, tz)
      expect(toInstant(p.date, p.time, tz).getTime()).toBe(truncado.getTime())
    }
  })

  test('weekdayOf cobre a semana de 2026-11-08 a 2026-11-14', () => {
    const esperado = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
    esperado.forEach((dia, i) => {
      expect(weekdayOf(addDays('2026-11-08', i))).toBe(dia)
    })
    expect(weekdayOf('2026-11-08')).toBe('SUNDAY')
    expect(weekdayOf('2026-11-14')).toBe('SATURDAY')
  })

  test('isLocalTime', () => {
    expect(isLocalTime('7:5')).toBe(false)
    expect(isLocalTime('07:60')).toBe(false)
    expect(isLocalTime('00:00')).toBe(true)
    expect(isLocalTime('23:59')).toBe(true)
  })

  test('isLocalDate recusa formatos fora do padrão', () => {
    expect(isLocalDate('2026-11-13')).toBe(true)
    expect(isLocalDate('2024-02-29')).toBe(true)
    expect(isLocalDate('2026-2-3')).toBe(false)
    expect(isLocalDate('2026-11-13T00:00')).toBe(false)
  })

  test('formatação na virada do dia em Manaus', () => {
    const antes = new Date('2026-11-14T03:59:00.000Z')
    const depois = new Date('2026-11-14T04:00:00.000Z')
    expect(formatDate(antes, 'America/Manaus')).toBe('13/11/2026')
    expect(formatTime(antes, 'America/Manaus')).toBe('23:59')
    expect(formatDate(depois, 'America/Manaus')).toBe('14/11/2026')
    expect(formatTime(depois, 'America/Manaus')).toBe('00:00')
    expect(formatDateTime(depois, 'America/Manaus')).toBe('14/11/2026 00:00')
  })

  test('formatação de meia-noite usa 00, nunca 24', () => {
    expect(formatTime(new Date('2026-11-13T03:00:00.000Z'), 'America/Sao_Paulo')).toBe('00:00')
  })

  test('minutesBetween e addMinutes', () => {
    const a = new Date('2026-11-13T15:00:00.000Z')
    expect(iso(addMinutes(a, 90))).toBe('2026-11-13T16:30:00.000Z')
    expect(minutesBetween(a, addMinutes(a, 45))).toBe(45)
    expect(minutesBetween(addMinutes(a, 45), a)).toBe(-45)
  })

  test('instante inválido lança RangeError', () => {
    expect(() => localParts(new Date(Number.NaN), 'America/Sao_Paulo')).toThrow(RangeError)
    expect(() => formatTime(new Date(Number.NaN), 'America/Sao_Paulo')).toThrow(RangeError)
    expect(() => addMinutes(new Date(Number.NaN), 5)).toThrow(RangeError)
  })

  test('addDays recusa data e quantidade inválidas', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError)
    expect(() => addDays('2026-02-01', 1.5)).toThrow(RangeError)
  })

  test('dia local atravessa o dia com salto de Nova York (23 horas)', () => {
    const r = localDayRange('2026-03-08', 'America/New_York')
    expect(minutesBetween(r.start, r.end)).toBe(23 * 60)
  })
})
