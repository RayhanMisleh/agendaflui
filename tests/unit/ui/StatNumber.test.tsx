// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { StatNumber } from '@/ui/components'

test('leitor de tela lê o valor formatado em reais', () => {
  render(<StatNumber value={123450} format="brl" label="Faturamento do mês" />)
  expect(screen.getByLabelText('Faturamento do mês')).toHaveTextContent('R$ 1.234,50')
})

test('inteiro usa o separador pt-BR, sem rolos nem texto duplicado', () => {
  const { container } = render(<StatNumber value={1234} label="Agendamentos" />)
  expect(screen.getByLabelText('Agendamentos')).toHaveTextContent('1.234')
  expect(screen.getByLabelText('Agendamentos').textContent).toBe('Agendamentos1.234')
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
})

test('tamanhos 44 e 32', () => {
  const { container, rerender } = render(<StatNumber value={3} label="Hoje" />)
  expect(container.firstElementChild).toHaveClass('af-statnum--lg')
  rerender(<StatNumber value={3} label="Hoje" size="md" />)
  expect(container.firstElementChild).toHaveClass('af-statnum--md')
})
