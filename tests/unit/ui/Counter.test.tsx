// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { Counter } from '@/ui/components'

test('leitor de tela lê o valor formatado', () => {
  render(<Counter value={123450} format="brl" label="Faturamento do mês" />)
  expect(screen.getByLabelText('Faturamento do mês')).toHaveTextContent('R$ 1.234,50')
})

test('inteiro usa separador pt-BR e os tambores ficam escondidos do leitor', () => {
  const { container } = render(<Counter value={1234} label="Agendamentos" />)
  expect(screen.getByLabelText('Agendamentos')).toHaveTextContent('1.234')
  expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
})
