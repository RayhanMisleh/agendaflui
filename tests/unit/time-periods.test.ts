import { describe, expect, test } from 'vitest'
import { fromIsoInstant, localMonthRange, localPeriods } from '@/server/time'

const at = (s: string) => fromIsoInstant(s)
const iso = (d: Date) => d.toISOString()
const pair = (r: { start: Date; end: Date }) => [iso(r.start), iso(r.end)]

describe('localMonthRange', () => {
  test('o mês de calendário do fuso, início inclusivo e fim exclusivo', () => {
    expect(pair(localMonthRange('2026-11-16', 'America/Sao_Paulo'))).toEqual(['2026-11-01T03:00:00.000Z', '2026-12-01T03:00:00.000Z'])
    expect(pair(localMonthRange('2026-02-28', 'America/Manaus'))).toEqual(['2026-02-01T04:00:00.000Z', '2026-03-01T04:00:00.000Z'])
  })

  test('mês que contém a virada do horário de verão usa o deslocamento de cada ponta', () => {
    // Nova York: novembro de 2026 começa em horário de verão (UTC-4) e termina no padrão (UTC-5).
    expect(pair(localMonthRange('2026-11-10', 'America/New_York'))).toEqual(['2026-11-01T04:00:00.000Z', '2026-12-01T05:00:00.000Z'])
    // Março de 2026: começa no padrão (UTC-5) e a virada é no dia 8; termina em horário de verão.
    expect(pair(localMonthRange('2026-03-20', 'America/New_York'))).toEqual(['2026-03-01T05:00:00.000Z', '2026-04-01T04:00:00.000Z'])
  })

  test('hemisfério sul: Sydney sai do horário de verão em abril', () => {
    expect(pair(localMonthRange('2026-04-05', 'Australia/Sydney'))).toEqual(['2026-03-31T13:00:00.000Z', '2026-04-30T14:00:00.000Z'])
  })

  test('mês que começa num dia sem meia-noite (São Paulo em 2018) começa na primeira hora que existe', () => {
    // Em 4/11/2018 a meia-noite não existiu: o relógio pulou de 23:59 para 01:00.
    expect(pair(localMonthRange('2018-11-04', 'America/Sao_Paulo'))).toEqual(['2018-11-01T03:00:00.000Z', '2018-12-01T02:00:00.000Z'])
  })

  test('data ou fuso inválidos lançam RangeError', () => {
    expect(() => localMonthRange('2026-13-01', 'America/Sao_Paulo')).toThrow(RangeError)
    expect(() => localMonthRange('2026-11-16', 'Marte/Olimpo')).toThrow(RangeError)
  })
})

describe('localPeriods', () => {
  test('hoje, mês até o fim de hoje, mês anterior inteiro e o mesmo trecho do mês anterior (São Paulo)', () => {
    const p = localPeriods(at('2026-11-16T15:00:00.000Z'), 'America/Sao_Paulo')
    expect(pair(p.today)).toEqual(['2026-11-16T03:00:00.000Z', '2026-11-17T03:00:00.000Z'])
    expect(pair(p.month)).toEqual(['2026-11-01T03:00:00.000Z', '2026-11-17T03:00:00.000Z'])
    expect(pair(p.previousMonth)).toEqual(['2026-10-01T03:00:00.000Z', '2026-11-01T03:00:00.000Z'])
    expect(pair(p.previousSamePeriod)).toEqual(['2026-10-01T03:00:00.000Z', '2026-10-17T03:00:00.000Z'])
  })

  test('23:30 em Manaus ainda é o dia local de Manaus; 00:30 do dia seguinte já é outro dia', () => {
    const tarde = localPeriods(at('2026-11-17T03:30:00.000Z'), 'America/Manaus')
    expect(pair(tarde.today)).toEqual(['2026-11-16T04:00:00.000Z', '2026-11-17T04:00:00.000Z'])
    const depois = localPeriods(at('2026-11-17T04:30:00.000Z'), 'America/Manaus')
    expect(pair(depois.today)).toEqual(['2026-11-17T04:00:00.000Z', '2026-11-18T04:00:00.000Z'])
  })

  test('primeiro dia do mês: o mês parcial é só hoje', () => {
    const p = localPeriods(at('2026-12-01T12:00:00.000Z'), 'America/Sao_Paulo')
    expect(pair(p.month)).toEqual(['2026-12-01T03:00:00.000Z', '2026-12-02T03:00:00.000Z'])
    expect(pair(p.previousSamePeriod)).toEqual(['2026-11-01T03:00:00.000Z', '2026-11-02T03:00:00.000Z'])
  })

  test('dia 31 depois de um mês mais curto: o mesmo trecho é o mês anterior inteiro', () => {
    const p = localPeriods(at('2026-03-31T12:00:00.000Z'), 'America/New_York')
    expect(pair(p.previousMonth)).toEqual(['2026-02-01T05:00:00.000Z', '2026-03-01T05:00:00.000Z'])
    expect(pair(p.previousSamePeriod)).toEqual(['2026-02-01T05:00:00.000Z', '2026-03-01T05:00:00.000Z'])
  })

  test('dia em que o horário de verão começa tem 23 horas (Nova York, 8/3/2026)', () => {
    const p = localPeriods(at('2026-03-08T15:00:00.000Z'), 'America/New_York')
    expect(pair(p.today)).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'])
    expect(pair(p.month)).toEqual(['2026-03-01T05:00:00.000Z', '2026-03-09T04:00:00.000Z'])
    expect(pair(p.previousSamePeriod)).toEqual(['2026-02-01T05:00:00.000Z', '2026-02-09T05:00:00.000Z'])
  })

  test('dia em que o horário de verão termina tem 25 horas (Nova York, 1/11/2026)', () => {
    const p = localPeriods(at('2026-11-01T12:00:00.000Z'), 'America/New_York')
    expect(pair(p.today)).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'])
    expect(pair(p.previousMonth)).toEqual(['2026-10-01T04:00:00.000Z', '2026-11-01T04:00:00.000Z'])
  })

  test('Sydney: o dia da saída do horário de verão (5/4/2026) tem 25 horas', () => {
    const p = localPeriods(at('2026-04-05T00:00:00.000Z'), 'Australia/Sydney')
    expect(pair(p.today)).toEqual(['2026-04-04T13:00:00.000Z', '2026-04-05T14:00:00.000Z'])
  })

  test('São Paulo em 2018: o dia que começou à 01:00 (sem meia-noite) tem 23 horas', () => {
    const p = localPeriods(at('2018-11-04T12:00:00.000Z'), 'America/Sao_Paulo')
    expect(pair(p.today)).toEqual(['2018-11-04T03:00:00.000Z', '2018-11-05T02:00:00.000Z'])
    expect(pair(p.month)).toEqual(['2018-11-01T03:00:00.000Z', '2018-11-05T02:00:00.000Z'])
  })

  test('janeiro: o mês anterior é dezembro do ano anterior', () => {
    const p = localPeriods(at('2027-01-10T12:00:00.000Z'), 'America/Sao_Paulo')
    expect(pair(p.previousMonth)).toEqual(['2026-12-01T03:00:00.000Z', '2027-01-01T03:00:00.000Z'])
    expect(pair(p.previousSamePeriod)).toEqual(['2026-12-01T03:00:00.000Z', '2026-12-11T03:00:00.000Z'])
  })

  test('instante ou fuso inválidos lançam RangeError', () => {
    expect(() => localPeriods(new Date(Number.NaN), 'America/Sao_Paulo')).toThrow(RangeError)
    expect(() => localPeriods(at('2026-11-16T15:00:00.000Z'), 'Marte/Olimpo')).toThrow(RangeError)
  })
})
