import { rotuloDoHorario } from '@/app/_lib/form-state'

const n = (date: string) => ({ iso: '2026-11-18T14:00:00.000Z', label: '10:00', date })

test('o horário sugerido do mesmo dia mostra só a hora', () => {
  expect(rotuloDoHorario(n('2026-11-17'), '2026-11-17')).toBe('10:00')
})

test('o horário sugerido de outro dia mostra o dia', () => {
  expect(rotuloDoHorario(n('2026-11-18'), '2026-11-17')).toBe('10:00 (18/11)')
})

test('sem o dia no horário (resposta antiga), mostra só a hora', () => {
  expect(rotuloDoHorario(n(''), '2026-11-17')).toBe('10:00')
})
