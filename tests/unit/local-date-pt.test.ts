import { describe, expect, test } from 'vitest'
import { dayNumber, formatLongDate, formatShortDayMonth, relativeDayLabel, shiftDate, weekdayIndex } from '@/shared/local-date-pt'

describe('local-date-pt', () => {
  test('dia da semana e rótulos', () => {
    expect(weekdayIndex('2026-11-29')).toBe(0)
    expect(weekdayIndex('2026-11-28')).toBe(6)
    expect(formatLongDate('2026-11-28')).toBe('sábado, 28 de novembro')
    expect(formatShortDayMonth('2026-11-28')).toBe('sáb., 28 de nov.')
  })
  test('hoje, amanhã e data curta', () => {
    expect(relativeDayLabel('2026-11-25', '2026-11-25')).toBe('Hoje')
    expect(relativeDayLabel('2026-11-26', '2026-11-25')).toBe('Amanhã')
    expect(relativeDayLabel('2026-11-29', '2026-11-25')).toBe('dom., 29 de nov.')
  })
  test('shiftDate atravessa mês, ano e bissexto', () => {
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftDate('2027-03-01', -1)).toBe('2027-02-28')
    expect(dayNumber('1970-01-01')).toBe(0)
  })
})
