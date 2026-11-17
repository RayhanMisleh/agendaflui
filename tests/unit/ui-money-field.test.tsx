// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DurationField, MoneyField, durationOptions } from '@/ui/components'
import { formatMoneyInput, parseMoney } from '@/ui/money'

describe('parseMoney', () => {
  test.each([
    ['35,90', 3590],
    ['35.90', 3590],
    ['35', 3500],
    ['35,9', 3590],
    ['35,', 3500],
    [',5', 50],
    ['0', 0],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234', 123400],
    ['R$ 35,90', 3590],
    ['  8000  ', 800000],
  ])('aceita %s como %i centavos', (texto, centavos) => {
    expect(parseMoney(texto)).toBe(centavos)
  })

  test.each(['', '   ', 'abc', '12abc', 'R$', '-5', '35,999', '1,5,5', '12.34.56', '1e3', '35,90,', '1,234'])('recusa %j', (texto) => {
    expect(parseMoney(texto)).toBeNull()
  })

  test('formatMoneyInput devolve o texto do campo', () => {
    expect(formatMoneyInput(3590)).toBe('35,90')
    expect(formatMoneyInput(5)).toBe('0,05')
    expect(formatMoneyInput(800000)).toBe('8000,00')
  })
})

describe('MoneyField', () => {
  test('aceita vírgula e ponto, leva só o texto no campo e não cria campo escondido', async () => {
    const { container } = render(<MoneyField name="price" aria-label="Preço" />)
    const campo = screen.getByLabelText('Preço')
    await userEvent.type(campo, '35,90')
    expect(campo).toHaveValue('35,90')
    await userEvent.clear(campo)
    await userEvent.type(campo, '35.90')
    expect(campo).toHaveValue('35.90')
    expect(campo).not.toHaveAttribute('aria-invalid')
    expect(container.querySelector('input[type="hidden"]')).toBeNull()
  })

  test('recusa texto: marca o campo como inválido e avisa', async () => {
    render(<MoneyField name="price" aria-label="Preço" />)
    const campo = screen.getByLabelText('Preço')
    await userEvent.type(campo, 'abc')
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Digite um valor em reais')
  })

  test('ao sair do campo arruma o valor para duas casas', async () => {
    render(<MoneyField name="price" aria-label="Preço" />)
    const campo = screen.getByLabelText('Preço') as HTMLInputElement
    await userEvent.type(campo, '35.9')
    fireEvent.blur(campo)
    expect(campo.value).toBe('35,90')
  })

  test('começa com o valor dado', () => {
    render(<MoneyField name="price" aria-label="Preço" defaultValue="80,00" />)
    expect(screen.getByLabelText('Preço')).toHaveValue('80,00')
  })
})

describe('DurationField', () => {
  test('lista só múltiplos da grade e mantém a duração atual fora dela', () => {
    expect(durationOptions(15, 60)).toEqual([15, 30, 45, 60])
    expect(durationOptions(30, 90, 40)).toEqual([30, 40, 60, 90])
  })

  test('mostra a duração escolhida', () => {
    render(<DurationField aria-label="Duração" name="durationMin" stepMin={15} value={45} />)
    expect(screen.getByLabelText('Duração')).toHaveValue('45')
    expect(screen.getByRole('option', { name: '1 h' })).toBeInTheDocument()
  })
})
