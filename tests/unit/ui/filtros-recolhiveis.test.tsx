// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { FiltrosRecolhiveis } from '@/app/app/painel/_lib/FiltrosRecolhiveis'

const campos = <label>Serviço<select name="servico"><option value="">Todos</option></select></label>

test('começa recolhido; o botão Filtros abre e fecha os campos e informa aria-expanded', () => {
  render(<FiltrosRecolhiveis ativos={0} filtros={campos} enviar={<button type="submit">Ver período</button>} />)
  const botao = screen.getByRole('button', { name: 'Filtros' })
  expect(botao).toHaveAttribute('aria-expanded', 'false')
  const corpo = document.getElementById(botao.getAttribute('aria-controls') ?? '')
  expect(corpo).not.toBeNull()
  expect(botao.closest('.af-filtros')).not.toHaveAttribute('data-open')

  fireEvent.click(botao)
  expect(botao).toHaveAttribute('aria-expanded', 'true')
  expect(botao.closest('.af-filtros')).toHaveAttribute('data-open')

  fireEvent.click(botao)
  expect(botao).toHaveAttribute('aria-expanded', 'false')
})

test('mostra quantos filtros estão aplicados e mantém o botão de enviar ao lado', () => {
  render(<FiltrosRecolhiveis ativos={2} filtros={campos} enviar={<button type="submit">Ver período</button>} />)
  expect(screen.getByRole('button', { name: /Filtros.*2 aplicados/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ver período' })).toBeInTheDocument()
})
