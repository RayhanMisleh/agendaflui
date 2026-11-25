// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { AbasEntrada } from '@/app/app/[slug]/_lib/AbasEntrada'

const nav = vi.hoisted(() => ({ pathname: '/pet-bom/entrar', query: '' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(nav.query) }))

beforeEach(() => {
  nav.pathname = '/pet-bom/entrar'
  nav.query = ''
})

const indicador = (c: HTMLElement) => c.querySelector<HTMLElement>('.af-entry__seg')!.style.getPropertyValue('--seg')

test('a aba da rota atual marca a página e o indicador fica na posição dela', () => {
  const { container } = render(<AbasEntrada slug="pet-bom" />)
  expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Criar conta' })).not.toHaveAttribute('aria-current')
  expect(indicador(container)).toBe('0')
})

test('no toque o indicador já desliza para a aba nova, antes de a rota mudar', () => {
  const { container } = render(<AbasEntrada slug="pet-bom" />)
  fireEvent.click(screen.getByRole('link', { name: 'Criar conta' }))
  expect(indicador(container)).toBe('1')
})

test('na rota do cadastro o indicador fica na segunda aba', () => {
  nav.pathname = '/pet-bom/cadastro'
  const { container } = render(<AbasEntrada slug="pet-bom" />)
  expect(indicador(container)).toBe('1')
})

test('o volta da loja segue nos dois links; volta de fora da loja é descartado', () => {
  nav.query = 'volta=%2Fpet-bom%2Fagendar'
  const { unmount } = render(<AbasEntrada slug="pet-bom" />)
  expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/pet-bom/cadastro?volta=%2Fpet-bom%2Fagendar')
  unmount()
  nav.query = 'volta=https%3A%2F%2Fmal.example'
  render(<AbasEntrada slug="pet-bom" />)
  expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/pet-bom/entrar')
})
