// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/contas/abc' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { NavTabs } from '@/ui/components/NavTabs'
import { ACCOUNT_TABS, accountTabs } from '@/app/dev/(app)/contas/[id]/tabs'

test('as abas da conta são links por URL e a aba da rota atual leva aria-current', () => {
  nav.pathname = '/contas/abc/equipe'
  render(<NavTabs label="Abas da conta" items={accountTabs('abc')} />)
  const menu = screen.getByRole('navigation', { name: 'Abas da conta' })
  const links = within(menu).getAllByRole('link')
  expect(links.map((l) => l.textContent)).toEqual(ACCOUNT_TABS.map((t) => t.label))
  expect(within(menu).getByRole('link', { name: 'Equipe' })).toHaveAttribute('aria-current', 'page')
  expect(within(menu).getByRole('link', { name: 'Equipe' })).toHaveAttribute('href', '/contas/abc/equipe')
  expect(links.filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1)
})

test('o resumo só fica ativo na rota exata da conta, não nas subrotas', () => {
  nav.pathname = '/contas/abc'
  const { rerender } = render(<NavTabs label="Abas da conta" items={accountTabs('abc')} />)
  expect(screen.getByRole('link', { name: 'Resumo' })).toHaveAttribute('aria-current', 'page')
  nav.pathname = '/contas/abc/marca'
  rerender(<NavTabs label="Abas da conta" items={accountTabs('abc')} />)
  expect(screen.getByRole('link', { name: 'Resumo' })).not.toHaveAttribute('aria-current')
  expect(screen.getByRole('link', { name: 'Marca' })).toHaveAttribute('aria-current', 'page')
})

test('as abas da conta não têm mais a aba Chaves; Integrações vem depois de Equipe', () => {
  expect(ACCOUNT_TABS.map((t) => t.label)).toEqual(['Resumo', 'Marca', 'Módulos', 'Regras', 'Equipe', 'Integrações', 'Auditoria'])
})
