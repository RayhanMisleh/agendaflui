import { describe, expect, test } from 'vitest'
import { computeSlots, fitsWorkingHours, overlaps } from '@/server/domain/scheduling/slots'

const SP = 'America/Sao_Paulo'
const z = (s: string) => new Date(s)
const iso = (ds: Date[]) => ds.map((d) => d.toISOString())
const labels = (ds: Date[]) => ds.map((d) => d.toISOString().slice(11, 16)) // UTC HH:mm
const base = {
  date: '2026-11-16',
  timeZone: SP,
  workingRanges: [
    { startMin: 540, endMin: 720 },
    { startMin: 780, endMin: 1080 },
  ],
  busy: [] as { start: Date; end: Date }[],
  blocked: [] as { start: Date; end: Date }[],
  durationMin: 60,
  stepMin: 30,
  bufferMin: 0,
  notBefore: z('2026-01-01T00:00:00Z'),
  notAfter: z('2027-01-01T00:00:00Z'),
}
const ten = { start: z('2026-11-16T13:00:00Z'), end: z('2026-11-16T14:00:00Z') } // 10:00–11:00 local

describe('computeSlots', () => {
  test('dia livre: 5 inícios de manhã e 9 à tarde', () => {
    const s = computeSlots(base)
    expect(s).toHaveLength(14)
    expect(s[0]!.toISOString()).toBe('2026-11-16T12:00:00.000Z')
    expect(s[4]!.toISOString()).toBe('2026-11-16T14:00:00.000Z')
    expect(s[5]!.toISOString()).toBe('2026-11-16T16:00:00.000Z')
    expect(s[13]!.toISOString()).toBe('2026-11-16T20:00:00.000Z')
  })

  test('agendamento das 10:00 às 11:00 tira 09:30, 10:00 e 10:30', () => {
    const s = computeSlots({ ...base, busy: [ten] })
    expect(labels(s).slice(0, 2)).toEqual(['12:00', '14:00'])
    expect(s).toHaveLength(11)
  })

  test('folga de 15 min dos dois lados esvazia a manhã', () => {
    const s = computeSlots({ ...base, bufferMin: 15, busy: [ten] })
    expect(s[0]!.toISOString()).toBe('2026-11-16T16:00:00.000Z')
    expect(s).toHaveLength(9)
  })

  test('bloqueio não recebe folga', () => {
    const s = computeSlots({ ...base, bufferMin: 15, blocked: [ten] })
    expect(labels(s).slice(0, 2)).toEqual(['12:00', '14:00'])
  })

  test('antecedência corta os inícios anteriores', () => {
    const s = computeSlots({ ...base, notBefore: z('2026-11-16T13:10:00Z') })
    expect(s[0]!.toISOString()).toBe('2026-11-16T13:30:00.000Z')
  })

  test('janela máxima corta os inícios a partir dela', () => {
    expect(computeSlots({ ...base, notAfter: z('2026-11-16T12:00:00Z') })).toEqual([])
    expect(computeSlots({ ...base, notAfter: z('2026-11-16T12:30:00Z') })).toHaveLength(1)
  })

  test('grade presa ao relógio, não ao início do expediente', () => {
    const s = computeSlots({ ...base, workingRanges: [{ startMin: 550, endMin: 720 }], durationMin: 30, stepMin: 15 })
    expect(s[0]!.toISOString()).toBe('2026-11-16T12:15:00.000Z')
  })

  test('passo de 60 com expediente 09:30–12:00 e duração 30: 10:00 e 11:00', () => {
    const s = computeSlots({ ...base, workingRanges: [{ startMin: 570, endMin: 720 }], durationMin: 30, stepMin: 60 })
    expect(iso(s)).toEqual(['2026-11-16T13:00:00.000Z', '2026-11-16T14:00:00.000Z'])
  })

  test('expediente até a meia-noite: o serviço precisa caber inteiro', () => {
    const s = computeSlots({ ...base, workingRanges: [{ startMin: 1320, endMin: 1440 }] })
    expect(iso(s)).toEqual(['2026-11-17T01:00:00.000Z', '2026-11-17T01:30:00.000Z', '2026-11-17T02:00:00.000Z'])
  })

  test('duração maior que o expediente: nenhum horário', () => {
    expect(computeSlots({ ...base, workingRanges: [{ startMin: 540, endMin: 570 }] })).toEqual([])
  })

  test('sem expediente: nenhum horário', () => {
    expect(computeSlots({ ...base, workingRanges: [] })).toEqual([])
  })

  test('início do horário de verão em Nova York: a hora inexistente não gera repetidos', () => {
    const s = computeSlots({ ...base, date: '2026-03-08', timeZone: 'America/New_York', workingRanges: [{ startMin: 60, endMin: 240 }], durationMin: 30 })
    expect(iso(s)).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T06:30:00.000Z', '2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00.000Z'])
  })

  test('fim do horário de verão em Nova York: a hora repetida aparece nas duas ocorrências', () => {
    const s = computeSlots({ ...base, date: '2026-11-01', timeZone: 'America/New_York', workingRanges: [{ startMin: 0, endMin: 180 }], stepMin: 60 })
    // 01:00 acontece duas vezes (05:00Z e 06:00Z): as duas são inícios bons.
    expect(iso(s)).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-01T05:00:00.000Z', '2026-11-01T06:00:00.000Z', '2026-11-01T07:00:00.000Z'])
  })

  test('resultado ordenado e sem repetidos com expediente fora de ordem e sobreposto', () => {
    const s = computeSlots({
      ...base,
      workingRanges: [{ startMin: 780, endMin: 900 }, { startMin: 540, endMin: 720 }, { startMin: 600, endMin: 720 }],
    })
    const ms = s.map((d) => d.getTime())
    expect(ms).toEqual([...new Set(ms)].sort((a, b) => a - b))
    expect(labels(s)).toEqual(['12:00', '12:30', '13:00', '13:30', '14:00', '16:00', '16:30', '17:00'])
  })

  test('serviço não atravessa a emenda entre dois intervalos que se encostam', () => {
    const s = computeSlots({ ...base, workingRanges: [{ startMin: 720, endMin: 780 }, { startMin: 540, endMin: 720 }] })
    expect(iso(s)).toEqual([
      '2026-11-16T12:00:00.000Z', '2026-11-16T12:30:00.000Z', '2026-11-16T13:00:00.000Z',
      '2026-11-16T13:30:00.000Z', '2026-11-16T14:00:00.000Z', '2026-11-16T15:00:00.000Z',
    ])
    expect(iso(s)).not.toContain('2026-11-16T14:30:00.000Z') // 11:30 local cruzaria a emenda
  })

  test('busy que só encosta no candidato: fica com folga 0, sai com folga 15', () => {
    const busy = [{ start: z('2026-11-16T12:00:00Z'), end: z('2026-11-16T13:00:00Z') }] // 09:00–10:00 local
    const a = computeSlots({ ...base, busy })
    expect(labels(a)).toContain('13:00') // 10:00 local começa onde o busy termina
    const b = computeSlots({ ...base, busy, bufferMin: 15 })
    expect(labels(b)).not.toContain('13:00')
  })

  test('blocked cobrindo o dia inteiro devolve vazio', () => {
    expect(computeSlots({ ...base, blocked: [{ start: z('2026-11-16T03:00:00Z'), end: z('2026-11-17T03:00:00Z') }] })).toEqual([])
  })

  test('conta em Manaus: primeiro início às 13:00Z', () => {
    expect(computeSlots({ ...base, timeZone: 'America/Manaus' })[0]!.toISOString()).toBe('2026-11-16T13:00:00.000Z')
  })

  test('busy e blocked vazios ou invertidos são ignorados', () => {
    const bad = { start: z('2026-11-16T14:00:00Z'), end: z('2026-11-16T13:00:00Z') }
    const eq = { start: z('2026-11-16T14:00:00Z'), end: z('2026-11-16T14:00:00Z') }
    expect(computeSlots({ ...base, busy: [bad, eq], blocked: [bad, eq], bufferMin: 15 })).toHaveLength(14)
  })

  test('entradas inválidas lançam RangeError', () => {
    for (const durationMin of [0, -5, 1.5, Number.NaN]) expect(() => computeSlots({ ...base, durationMin })).toThrow(RangeError)
    for (const stepMin of [0, -5, 1.5, Number.NaN]) expect(() => computeSlots({ ...base, stepMin })).toThrow(RangeError)
    for (const bufferMin of [-1, 1.5, Number.NaN]) expect(() => computeSlots({ ...base, bufferMin })).toThrow(RangeError)
    for (const r of [{ startMin: 600, endMin: 600 }, { startMin: 700, endMin: 600 }, { startMin: -1, endMin: 600 }, { startMin: 600, endMin: 1441 }, { startMin: 1.5, endMin: 600 }]) {
      expect(() => computeSlots({ ...base, workingRanges: [r] })).toThrow(RangeError)
    }
  })

  test('não muta os arrays recebidos', () => {
    const workingRanges = Object.freeze([Object.freeze({ startMin: 780, endMin: 900 }), Object.freeze({ startMin: 540, endMin: 720 })])
    const busy = Object.freeze([Object.freeze({ ...ten })])
    const blocked = Object.freeze([Object.freeze({ ...ten })])
    expect(() => computeSlots({ ...base, workingRanges, busy, blocked })).not.toThrow()
  })
})

describe('overlaps', () => {
  test('encostar não conta', () => {
    const a = { start: z('2026-11-16T12:00:00Z'), end: z('2026-11-16T13:00:00Z') }
    expect(overlaps(a, { start: z('2026-11-16T13:00:00Z'), end: z('2026-11-16T14:00:00Z') })).toBe(false)
    expect(overlaps(a, { start: z('2026-11-16T12:59:00Z'), end: z('2026-11-16T14:00:00Z') })).toBe(true)
  })
})

describe('limites inválidos', () => {
  const invalida = new Date(Number.NaN)
  const ok = { start: z('2026-11-16T13:00:00Z'), end: z('2026-11-16T14:00:00Z') }

  test.each([
    ['notBefore', { notBefore: invalida }],
    ['notAfter', { notAfter: invalida }],
    ['início de busy', { busy: [{ start: invalida, end: ok.end }] }],
    ['fim de busy', { busy: [{ start: ok.start, end: invalida }] }],
    ['início de blocked', { blocked: [{ start: invalida, end: ok.end }] }],
    ['fim de blocked', { blocked: [{ start: ok.start, end: invalida }] }],
  ])('Date inválida em %s lança RangeError em vez de desligar o limite', (_nome, patch) => {
    expect(() => computeSlots({ ...base, ...patch })).toThrow(RangeError)
  })
})

describe('fitsWorkingHours', () => {
  const w = { date: '2026-11-16', timeZone: SP, workingRanges: base.workingRanges }
  test('início igual ou depois do fim lança RangeError', () => {
    const t = z('2026-11-16T14:00:00Z')
    expect(() => fitsWorkingHours({ ...w, start: t, end: t })).toThrow(RangeError)
    expect(() => fitsWorkingHours({ ...w, start: z('2026-11-16T15:00:00Z'), end: t })).toThrow(RangeError)
    expect(() => fitsWorkingHours({ ...w, start: new Date(Number.NaN), end: t })).toThrow(RangeError)
  })
  test('cabe dentro de um intervalo; invadir o almoço não', () => {
    expect(fitsWorkingHours({ ...w, start: z('2026-11-16T14:00:00Z'), end: z('2026-11-16T15:00:00Z') })).toBe(true)
    expect(fitsWorkingHours({ ...w, start: z('2026-11-16T14:30:00Z'), end: z('2026-11-16T15:30:00Z') })).toBe(false)
  })
})

describe('computeSlots na troca do horário de verão', () => {
  const dst = { ...base, busy: [], blocked: [], notBefore: z('2020-01-01T00:00:00Z'), notAfter: z('2030-01-01T00:00:00Z') }

  describe('dia de 25 horas (fim do horário de verão)', () => {
    test('Lisboa: 01:00 a 02:00 acontece duas vezes e as duas ocorrências são oferecidas', () => {
      const s = computeSlots({ ...dst, date: '2026-10-25', timeZone: 'Europe/Lisbon', workingRanges: [{ startMin: 0, endMin: 180 }], durationMin: 60, stepMin: 60 })
      // 00:00 WEST, 01:00 WEST, 01:00 WET, 02:00 WET (03:00 WET encerra o expediente)
      expect(iso(s)).toEqual(['2026-10-24T23:00:00.000Z', '2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z', '2026-10-25T02:00:00.000Z'])
    })

    test('Lisboa: o último início do expediente é pelo tempo real, não pelos minutos do relógio', () => {
      // Expediente 00:00–02:00 tem 3 horas reais; serviço de 60 min cabe a partir de 23:00Z, 00:00Z e 01:00Z.
      const s = computeSlots({ ...dst, date: '2026-10-25', timeZone: 'Europe/Lisbon', workingRanges: [{ startMin: 0, endMin: 120 }], durationMin: 60, stepMin: 30 })
      expect(iso(s)).toEqual([
        '2026-10-24T23:00:00.000Z',
        '2026-10-24T23:30:00.000Z',
        '2026-10-25T00:00:00.000Z',
        '2026-10-25T00:30:00.000Z',
        '2026-10-25T01:00:00.000Z',
      ])
    })

    test('Nova York: a segunda ocorrência de 01:30 também é oferecida', () => {
      const s = computeSlots({ ...dst, date: '2026-11-01', timeZone: 'America/New_York', workingRanges: [{ startMin: 60, endMin: 120 }], durationMin: 30, stepMin: 30 })
      expect(iso(s)).toEqual(['2026-11-01T05:00:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-01T06:00:00.000Z', '2026-11-01T06:30:00.000Z'])
    })

    test('ocupação da primeira ocorrência não esconde a segunda', () => {
      const s = computeSlots({
        ...dst,
        date: '2026-11-01',
        timeZone: 'America/New_York',
        workingRanges: [{ startMin: 60, endMin: 120 }],
        durationMin: 30,
        stepMin: 30,
        busy: [{ start: z('2026-11-01T05:00:00Z'), end: z('2026-11-01T06:00:00Z') }],
      })
      expect(iso(s)).toEqual(['2026-11-01T06:00:00.000Z', '2026-11-01T06:30:00.000Z'])
    })
  })

  describe('dia de 23 horas (início do horário de verão)', () => {
    test('Lisboa: nenhum início cai na hora que não existe, mesmo com passo que não divide 60', () => {
      // Grade de 40 em 40 minutos: 00:00, 00:40, 01:20 (não existe), 02:00, 02:40, 03:20...
      const s = computeSlots({ ...dst, date: '2026-03-29', timeZone: 'Europe/Lisbon', workingRanges: [{ startMin: 0, endMin: 240 }], durationMin: 20, stepMin: 40 })
      expect(iso(s)).toEqual([
        '2026-03-29T00:00:00.000Z',
        '2026-03-29T00:40:00.000Z',
        '2026-03-29T01:00:00.000Z', // 02:00 WEST
        '2026-03-29T01:40:00.000Z', // 02:40 WEST
        '2026-03-29T02:20:00.000Z', // 03:20 WEST
      ])
      for (const inicio of s) {
        const minutoLocal = (inicio.getTime() - z('2026-03-29T00:00:00Z').getTime()) / 60000 + (inicio.getTime() >= z('2026-03-29T01:00:00Z').getTime() ? 60 : 0)
        expect(minutoLocal % 40).toBe(0)
      }
    })

    test('Nova York: o início da grade que cai na hora inexistente é pulado, sem deslocar para fora da grade', () => {
      // Grade de 45 em 45: 01:30 (06:30Z), 02:15 (não existe), 03:00 (07:00Z), 03:45 (07:45Z).
      const s = computeSlots({ ...dst, date: '2026-03-08', timeZone: 'America/New_York', workingRanges: [{ startMin: 60, endMin: 240 }], durationMin: 15, stepMin: 45 })
      expect(iso(s)).toEqual(['2026-03-08T06:30:00.000Z', '2026-03-08T07:00:00.000Z', '2026-03-08T07:45:00.000Z'])
    })

    test('serviço não atravessa o fim do expediente que perdeu uma hora', () => {
      // Expediente 00:00–03:00 em Lisboa tem 2 horas reais.
      const s = computeSlots({ ...dst, date: '2026-03-29', timeZone: 'Europe/Lisbon', workingRanges: [{ startMin: 0, endMin: 180 }], durationMin: 60, stepMin: 60 })
      expect(iso(s)).toEqual(['2026-03-29T00:00:00.000Z', '2026-03-29T01:00:00.000Z'])
    })
  })
})
