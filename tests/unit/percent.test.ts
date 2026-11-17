import { formatPercentInput, parsePercentBps } from '@/shared/percent'

test('porcentagem digitada vira pontos-base, de 0 a 100 com até duas casas', () => {
  expect(parsePercentBps('30')).toBe(3000)
  expect(parsePercentBps('12,5')).toBe(1250)
  expect(parsePercentBps('12.50%')).toBe(1250)
  expect(parsePercentBps('100')).toBe(10_000)
  expect(parsePercentBps('100,01')).toBeNull()
  expect(parsePercentBps('101')).toBeNull()
  expect(parsePercentBps('1,234')).toBeNull()
  expect(parsePercentBps('-5')).toBeNull()
  expect(parsePercentBps('')).toBeNull()
})

test('pontos-base voltam como o campo mostra', () => {
  expect(formatPercentInput(3000)).toBe('30')
  expect(formatPercentInput(1250)).toBe('12,5')
  expect(formatPercentInput(1205)).toBe('12,05')
})
