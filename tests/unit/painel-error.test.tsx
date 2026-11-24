// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import ErroDoApp from '@/app/app/error'
import ErroDoPainel from '@/app/app/painel/error'
import NotFound from '@/app/not-found'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

test('mostra o título e a ação; "Tentar de novo" chama reset', () => {
  const reset = vi.fn()
  render(<ErroDoPainel error={new Error('x')} reset={reset} />)
  expect(screen.getByRole('heading', { name: 'Não deu para abrir esta tela' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/painel')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(reset).toHaveBeenCalledTimes(1)
})

test('nunca mostra a mensagem do erro', () => {
  const erro = Object.assign(new Error('segredo@x.com'), { digest: 'abc123' })
  const { container } = render(<ErroDoPainel error={erro} reset={() => undefined} />)
  expect(container.textContent).not.toContain('segredo@x.com')
  render(<ErroDoApp error={erro} reset={() => undefined} />)
  expect(document.body.textContent).not.toContain('segredo@x.com')
  expect(console.error).toHaveBeenCalledWith(expect.any(String), 'abc123')
})

test('o erro do app usa a tela da marca com "Ir para o início"', () => {
  render(<ErroDoApp error={new Error('x')} reset={() => undefined} />)
  expect(screen.getByRole('link', { name: 'Ir para o início' })).toHaveAttribute('href', '/')
})

test('not-found raiz tem o link "Ir para o início"', () => {
  render(<NotFound />)
  expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Ir para o início' })).toHaveAttribute('href', '/')
})
