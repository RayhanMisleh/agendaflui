// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { GoogleButton } from '@/ui/components'

test('enabled=false não renderiza nada (regra 11)', () => {
  const { container } = render(<GoogleButton enabled={false} fluxo="entrar" />)
  expect(container).toBeEmptyDOMElement()
})

test('o formulário posta para /google/entrar com fluxo, slug e convite, e o rótulo padrão', () => {
  const { container } = render(<GoogleButton enabled fluxo="convite" slug="pet-bom" convite="tok123" />)
  const form = container.querySelector('form')
  expect(form).toHaveAttribute('action', '/google/entrar')
  expect(form).toHaveAttribute('method', 'post')
  const valor = (n: string) => container.querySelector<HTMLInputElement>(`input[name="${n}"]`)?.value
  expect(valor('fluxo')).toBe('convite')
  expect(valor('slug')).toBe('pet-bom')
  expect(valor('convite')).toBe('tok123')
  expect(screen.getByRole('button', { name: 'Continuar com Google' })).toBeEnabled()
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})

test('sem slug nem convite, os campos não existem', () => {
  const { container } = render(<GoogleButton enabled fluxo="entrar" label="Entrar com Google" />)
  expect(container.querySelector('input[name="slug"]')).toBeNull()
  expect(container.querySelector('input[name="convite"]')).toBeNull()
  expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeInTheDocument()
})
