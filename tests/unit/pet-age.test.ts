import { expect, test } from 'vitest'
import { petAgeLabel } from '@/server/domain/pets/age'

test('idade em meses e anos', () => {
  expect(petAgeLabel('2026-11', '2026-11-16')).toBe('Menos de 1 mês')
  expect(petAgeLabel('2026-10', '2026-11-16')).toBe('1 mês')
  expect(petAgeLabel('2026-03', '2026-11-16')).toBe('8 meses')
  expect(petAgeLabel('2025-11', '2026-11-16')).toBe('1 ano')
  expect(petAgeLabel('2023-05', '2026-11-16')).toBe('3 anos')
  expect(petAgeLabel('2023-05-01', '2026-11-16')).toBe('3 anos')
})

test('mês futuro não tem idade', () => {
  expect(petAgeLabel('2026-12', '2026-11-16')).toBeNull()
})
