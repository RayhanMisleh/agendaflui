import { describe, expect, test } from 'vitest'
import {
  WEEKDAYS,
  compareLocalDates,
  daysBetween,
  fromEpochMs,
  fromIsoInstant,
  toIsoInstant,
  dbDateToLocal,
  isMinuteLabel,
  isoWeekRange,
  localToDbDate,
  minuteLabel,
  minuteOfDay,
  minuteToInstant,
  parseMinuteLabel,
  startOfUtcHour,
} from '@/server/time'

const iso = (d: Date) => d.toISOString()

describe('minuto do dia e instante', () => {
  test('minuto do dia vira instante no fuso da conta', () => {
    expect(iso(minuteToInstant('2026-11-16', 540, 'America/Sao_Paulo'))).toBe('2026-11-16T12:00:00.000Z')
    expect(iso(minuteToInstant('2026-11-16', 540, 'America/Manaus'))).toBe('2026-11-16T13:00:00.000Z')
  })
  test('1440 é a meia-noite do dia seguinte', () => {
    expect(iso(minuteToInstant('2026-11-16', 1440, 'America/Sao_Paulo'))).toBe('2026-11-17T03:00:00.000Z')
    expect(iso(minuteToInstant('2026-12-31', 1440, 'America/Sao_Paulo'))).toBe('2027-01-01T03:00:00.000Z')
  })
  test('minuto inexistente em Nova York avança; fora de 0..1440 lança', () => {
    expect(iso(minuteToInstant('2026-03-08', 150, 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z')
    expect(() => minuteToInstant('2026-11-16', 1441, 'America/Sao_Paulo')).toThrow(RangeError)
    expect(() => minuteToInstant('2026-11-16', -1, 'America/Sao_Paulo')).toThrow(RangeError)
  })
  test('hora repetida em Nova York usa a primeira ocorrência', () => {
    expect(iso(minuteToInstant('2026-11-01', 90, 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z')
  })
  test('minuto não inteiro lança, com o valor na mensagem', () => {
    expect(() => minuteToInstant('2026-11-16', 540.5, 'America/Sao_Paulo')).toThrow(/540\.5/)
    expect(() => minuteToInstant('2026-11-16', Number.NaN, 'America/Sao_Paulo')).toThrow(RangeError)
  })
  test('minuteOfDay é a inversa', () => {
    expect(minuteOfDay(new Date('2026-11-16T12:30:00.000Z'), 'America/Sao_Paulo')).toBe(570)
    expect(minuteOfDay(new Date('2026-11-17T02:59:00.000Z'), 'America/Sao_Paulo')).toBe(1439)
  })
  test('minuteOfDay na virada do ano em Manaus', () => {
    expect(minuteOfDay(new Date('2027-01-01T03:59:00.000Z'), 'America/Manaus')).toBe(1439)
    expect(minuteOfDay(new Date('2027-01-01T04:00:00.000Z'), 'America/Manaus')).toBe(0)
  })
})

describe('rótulos de minuto', () => {
  test('minuteLabel e parseMinuteLabel', () => {
    expect(minuteLabel(0)).toBe('00:00')
    expect(minuteLabel(545)).toBe('09:05')
    expect(minuteLabel(1440)).toBe('24:00')
    expect(parseMinuteLabel('09:05')).toBe(545)
    expect(parseMinuteLabel('24:00')).toBe(1440)
    for (const bad of ['24:01', '9:5', '25:00', 'abc', '']) {
      expect(() => parseMinuteLabel(bad)).toThrow(RangeError)
    }
  })
  test('isMinuteLabel diz se o rótulo HH:mm existe, de 00:00 a 24:00', () => {
    for (const ok of ['00:00', '09:05', '23:59', '24:00']) expect(isMinuteLabel(ok)).toBe(true)
    for (const bad of ['24:01', '9:5', '25:00', '12:60', 'abc', '']) expect(isMinuteLabel(bad)).toBe(false)
  })
  test('minuteLabel recusa minuto fora de 0..1440 ou não inteiro', () => {
    expect(() => minuteLabel(1441)).toThrow(RangeError)
    expect(() => minuteLabel(-1)).toThrow(RangeError)
    expect(() => minuteLabel(1.5)).toThrow(RangeError)
  })
})

describe('datas de banco', () => {
  test('não dependem do fuso do processo', () => {
    expect(dbDateToLocal(new Date('2026-11-16T00:00:00.000Z'))).toBe('2026-11-16')
    expect(iso(localToDbDate('2026-11-16'))).toBe('2026-11-16T00:00:00.000Z')
    expect(() => localToDbDate('2026-02-30')).toThrow(RangeError)
  })
  test('Date que não está à meia-noite UTC lança', () => {
    expect(() => dbDateToLocal(new Date('2026-11-16T03:00:00.000Z'))).toThrow(RangeError)
    expect(() => dbDateToLocal(new Date(Number.NaN))).toThrow(RangeError)
  })
})

describe('semana, comparação e diferença', () => {
  test('WEEKDAYS tem os sete dias começando em SUNDAY', () => {
    expect(WEEKDAYS).toEqual(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'])
  })
  test('isoWeekRange vai de segunda a domingo', () => {
    expect(isoWeekRange('2026-11-18')).toEqual({ start: '2026-11-16', end: '2026-11-22' })
    expect(isoWeekRange('2026-11-22')).toEqual({ start: '2026-11-16', end: '2026-11-22' })
    expect(isoWeekRange('2026-11-16')).toEqual({ start: '2026-11-16', end: '2026-11-22' })
  })
  test('isoWeekRange na virada de ano', () => {
    expect(isoWeekRange('2026-12-31')).toEqual({ start: '2026-12-28', end: '2027-01-03' })
  })
  test('compareLocalDates e daysBetween', () => {
    expect(compareLocalDates('2026-11-16', '2026-11-17')).toBe(-1)
    expect(compareLocalDates('2026-11-17', '2026-11-16')).toBe(1)
    expect(compareLocalDates('2026-11-16', '2026-11-16')).toBe(0)
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
    expect(daysBetween('2027-01-02', '2026-12-30')).toBe(-3)
  })
})

describe('fromEpochMs', () => {
  test('aceita inteiros dentro do limite de Date', () => {
    expect(iso(fromEpochMs(0))).toBe('1970-01-01T00:00:00.000Z')
    expect(fromEpochMs(8.64e15).getTime()).toBe(8.64e15)
    expect(fromEpochMs(-8.64e15).getTime()).toBe(-8.64e15)
  })

  test('recusa fora do limite, não inteiro e não finito', () => {
    for (const ms of [8.64e15 + 1, -8.64e15 - 1, 9e15, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => fromEpochMs(ms)).toThrow(RangeError)
    }
  })
})

describe('fromIsoInstant', () => {
  test('lê ISO UTC com ou sem milissegundos e devolve o mesmo instante de toIsoInstant', () => {
    expect(toIsoInstant(fromIsoInstant('2027-01-15T13:00:00.000Z'))).toBe('2027-01-15T13:00:00.000Z')
    expect(fromIsoInstant('2027-01-15T13:00:00Z').getTime()).toBe(fromIsoInstant('2027-01-15T13:00:00.000Z').getTime())
    expect(fromIsoInstant('2027-01-15T13:00:00.5Z').getTime() % 1000).toBe(500)
  })

  test('recusa data sem hora, deslocamento, texto livre e dia que não existe', () => {
    for (const ruim of ['2027-01-15', '2027-01-15T13:00:00+03:00', '2027-01-15T13:00:00', 'amanhã', '', '2027-02-31T10:00:00Z', ' 2027-01-15T13:00:00Z']) {
      expect(() => fromIsoInstant(ruim), ruim).toThrow(RangeError)
    }
  })
})

describe('startOfUtcHour', () => {
  test('trunca para a hora cheia em UTC, sem depender do fuso', () => {
    expect(toIsoInstant(startOfUtcHour(fromIsoInstant('2026-11-16T10:59:59.999Z')))).toBe('2026-11-16T10:00:00.000Z')
    expect(toIsoInstant(startOfUtcHour(fromIsoInstant('2026-11-16T10:00:00.000Z')))).toBe('2026-11-16T10:00:00.000Z')
    expect(toIsoInstant(startOfUtcHour(fromEpochMs(-1)))).toBe('1969-12-31T23:00:00.000Z')
  })

  test('recusa instante inválido', () => {
    expect(() => startOfUtcHour(new Date(Number.NaN))).toThrow(RangeError)
  })
})
