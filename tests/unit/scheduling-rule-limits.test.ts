import { parseSchedulingRules, RULE_LIMITS, SLOT_STEPS } from '@/server/domain/settings/scheduling-rules'

test('as grades exportadas são as que o esquema aceita, e nenhuma outra', () => {
  expect([...SLOT_STEPS]).toEqual([5, 10, 15, 20, 30, 60])
  for (const g of SLOT_STEPS) expect(parseSchedulingRules({ slotStepMin: g })).toEqual({ slotStepMin: g })
  expect(() => parseSchedulingRules({ slotStepMin: 25 })).toThrow()
})

test.each(['minLeadMin', 'maxAdvanceDays', 'customerChangeWindowMin', 'bufferMin'] as const)('%s: os limites exportados são os do esquema', (campo) => {
  const { min, max } = RULE_LIMITS[campo]
  expect(parseSchedulingRules({ [campo]: min })).toEqual({ [campo]: min })
  expect(parseSchedulingRules({ [campo]: max })).toEqual({ [campo]: max })
  expect(() => parseSchedulingRules({ [campo]: min - 1 })).toThrow()
  expect(() => parseSchedulingRules({ [campo]: max + 1 })).toThrow()
})

test('o intervalo entre atendimentos anda de 5 em 5', () => {
  expect(RULE_LIMITS.bufferMin.step).toBe(5)
  expect(() => parseSchedulingRules({ bufferMin: 7 })).toThrow()
})
