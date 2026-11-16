import { customerChangeDeadline, withinCustomerWindow } from '@/server/domain/scheduling/change-window'

const INICIO = new Date('2026-11-16T13:00:00Z')

describe('prazo de alteração do cliente', () => {
  test('o prazo é o início menos a janela', () => {
    expect(customerChangeDeadline(INICIO, 120).toISOString()).toBe('2026-11-16T11:00:00.000Z')
    expect(customerChangeDeadline(INICIO, 0).getTime()).toBe(INICIO.getTime())
  })

  test('exatamente no prazo é permitido; um milissegundo depois, não', () => {
    const prazo = customerChangeDeadline(INICIO, 120)
    expect(withinCustomerWindow(prazo, INICIO, 120)).toBe(true)
    expect(withinCustomerWindow(new Date(prazo.getTime() + 1), INICIO, 120)).toBe(false)
    expect(withinCustomerWindow(new Date(prazo.getTime() - 1), INICIO, 120)).toBe(true)
  })
})
