// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { CalendarDays, House, Users } from 'lucide-react'
import { ShellNav } from '@/ui/shells/ShellNav'

const rota = vi.hoisted(() => ({ atual: '/painel' }))
vi.mock('next/navigation', () => ({ usePathname: () => rota.atual }))

const itens = [
  { href: '/painel', label: 'Início', exact: true, icon: <House /> },
  { href: '/painel/agenda', label: 'Agenda', icon: <CalendarDays /> },
  { href: '/painel/clientes', label: 'Clientes', icon: <Users /> },
]

test('o destino ativo vem da rota e muda sem remontar o menu', () => {
  rota.atual = '/painel'
  const { rerender } = render(<ShellNav items={itens} userPlate={null} />)
  const menu = screen.getByRole('navigation', { name: 'Principal' })
  const agenda = screen.getByRole('link', { name: 'Agenda' })
  expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
  expect(agenda).not.toHaveAttribute('aria-current')

  rota.atual = '/painel/agenda/outra'
  rerender(<ShellNav items={itens} userPlate={null} />)
  expect(screen.getByRole('navigation', { name: 'Principal' })).toBe(menu)
  expect(screen.getByRole('link', { name: 'Agenda' })).toBe(agenda)
  expect(agenda).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
})
