// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { EmptyHint, PhoneLink } from '@/ui/components'

test('PhoneLink liga para o número com DDI e mostra o rótulo', () => {
  render(<PhoneLink phone="5511984217733" label="(11) 98421-7733" />)
  const a = screen.getByRole('link', { name: '(11) 98421-7733' })
  expect(a).toHaveAttribute('href', 'tel:+5511984217733')
})

test('PhoneLink sem número não vira link vazio', () => {
  render(<PhoneLink phone={null} />)
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('Sem telefone')).toBeInTheDocument()
})

test('PhoneLink aceita um número escrito com sinais e guarda só os dígitos no href', () => {
  render(<PhoneLink phone="+55 (11) 98421-7733" label="Ligar para Ana" />)
  expect(screen.getByRole('link', { name: 'Ligar para Ana' })).toHaveAttribute('href', 'tel:+5511984217733')
})

test('EmptyHint é uma dica curta, sem título nem bolhas', () => {
  const { container } = render(<EmptyHint>Nenhum atendimento até o fim do dia.</EmptyHint>)
  expect(screen.getByText('Nenhum atendimento até o fim do dia.')).toBeInTheDocument()
  expect(container.querySelector('h1, h2, h3, h4')).toBeNull()
  expect(container.querySelector('.af-bubbles, .af-empty__art')).toBeNull()
})
