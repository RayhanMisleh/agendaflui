import { timeZoneChoices } from '@/server/time'

test('os fusos pedidos vão no topo, na ordem pedida, e o resto vem sem repetir', () => {
  const { top, rest } = timeZoneChoices(['America/Sao_Paulo', 'America/Manaus', 'America/Noronha'])
  expect(top).toEqual(['America/Sao_Paulo', 'America/Manaus', 'America/Noronha'])
  expect(rest).toContain('Europe/Lisbon')
  expect(rest).toContain('America/New_York')
  for (const t of top) expect(rest).not.toContain(t)
  expect(new Set(rest).size).toBe(rest.length)
  expect([...rest].sort()).toEqual(rest)
})

test('fuso inexistente na lista do topo é ignorado, e todo fuso devolvido é válido', async () => {
  const { top, rest } = timeZoneChoices(['America/Sao_Paulo', 'Marte/Olimpo'])
  expect(top).toEqual(['America/Sao_Paulo'])
  const { isValidTimeZone } = await import('@/server/time')
  for (const t of rest) expect(isValidTimeZone(t), t).toBe(true)
})
