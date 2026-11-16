import { describe, expect, test } from 'vitest'
import { ACTIVE_STATUSES, canTransition } from '@/server/domain/scheduling/status'

const TODAS = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW'] as const

const PERMITIDAS = new Set([
  'PENDING>CONFIRMED',
  'PENDING>CANCELED',
  'CONFIRMED>CANCELED',
  'CONFIRMED>COMPLETED',
  'CONFIRMED>NO_SHOW',
  'COMPLETED>CONFIRMED',
  'NO_SHOW>CONFIRMED',
])

describe('canTransition', () => {
  for (const from of TODAS) {
    for (const to of TODAS) {
      const esperado = PERMITIDAS.has(`${from}>${to}`)
      test(`${from} → ${to} ${esperado ? 'é permitida' : 'não é permitida'}`, () => {
        expect(canTransition(from, to)).toBe(esperado)
      })
    }
  }

  test('são exatamente 7 transições permitidas em 25 combinações', () => {
    const permitidas = TODAS.flatMap((from) => TODAS.map((to) => canTransition(from, to))).filter(Boolean)
    expect(TODAS.length ** 2).toBe(25)
    expect(permitidas).toHaveLength(7)
  })
})

test('situações ativas ocupam o horário do profissional', () => {
  expect([...ACTIVE_STATUSES]).toEqual(['PENDING', 'CONFIRMED', 'COMPLETED'])
})
