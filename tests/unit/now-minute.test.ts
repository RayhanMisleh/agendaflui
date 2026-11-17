import { nowMinute } from '@/ui/components/planner/now-minute'

test('sem minuto do servidor não há linha', () => {
  expect(nowMinute(null, 0, 120_000)).toBeNull()
})

test('soma só os minutos inteiros desde que o servidor mandou o minuto', () => {
  expect(nowMinute(600, 1_000, 1_000)).toBe(600)
  expect(nowMinute(600, 1_000, 60_999)).toBe(600)
  expect(nowMinute(600, 1_000, 61_000)).toBe(601)
  expect(nowMinute(600, 1_000, 601_000)).toBe(610)
})

test('quando o servidor manda um minuto novo, o tempo decorrido recomeça do zero', () => {
  // Página aberta há 10 min; a revalidação chega às 610 e a chegada é registrada de novo.
  expect(nowMinute(610, 601_000, 601_000)).toBe(610)
  expect(nowMinute(610, 601_000, 661_000)).toBe(611)
})

test('relógio que anda para trás nunca devolve minuto anterior ao do servidor', () => {
  expect(nowMinute(600, 10_000, 5_000)).toBe(600)
})
