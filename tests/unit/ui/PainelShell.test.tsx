// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { CalendarDays, Users } from 'lucide-react'
import { PainelShell } from '@/ui/shells/PainelShell'
import { ShellPage } from '@/ui/shells/ShellPage'
import { deriveTheme } from '@/ui/theme/derive'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'

const theme = deriveTheme(AGENDAFLUI_BRAND)
const base = {
  theme,
  brand: { name: 'Patas e Pelos', logoUrl: null, symbolUrl: null },
  nav: [
    { href: '/agenda', label: 'Agenda', icon: CalendarDays, active: true },
    { href: '/clientes', label: 'Clientes', icon: Users, disabled: true },
  ],
  user: { name: 'Marina Lopes', roleLabel: 'Dona', avatarUrl: null },
}

test('sem logo, a marca aparece pelo nome', () => {
  render(<PainelShell {...base}>conteúdo</PainelShell>)
  expect(screen.getAllByText('Patas e Pelos').length).toBeGreaterThan(0)
  expect(screen.queryByRole('img', { name: 'Patas e Pelos' })).toBeNull()
})

test('item desabilitado tem aria-disabled e não é link; o ativo tem aria-current', () => {
  render(<PainelShell {...base}>conteúdo</PainelShell>)
  expect(screen.queryByRole('link', { name: 'Clientes' })).toBeNull()
  const off = screen.getAllByText('Clientes')[0]!.closest('[aria-disabled]')
  expect(off).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getAllByRole('link', { name: 'Agenda' })[0]).toHaveAttribute('aria-current', 'page')
})

test('supportBanner aparece só quando informado', () => {
  const { rerender } = render(<PainelShell {...base}>x</PainelShell>)
  expect(screen.queryByText('Você está no painel de Patas e Pelos como suporte.')).toBeNull()
  rerender(
    <PainelShell {...base} supportBanner="Você está no painel de Patas e Pelos como suporte.">
      x
    </PainelShell>,
  )
  expect(screen.getByText('Você está no painel de Patas e Pelos como suporte.')).toBeInTheDocument()
})

test('supportAction aparece dentro da faixa e só com a faixa', () => {
  const { rerender } = render(
    <PainelShell {...base} supportBanner="Você está em modo suporte na conta Patas e Pelos" supportAction={<button type="button">Encerrar</button>}>
      x
    </PainelShell>,
  )
  const faixa = screen.getByRole('note')
  expect(faixa).toContainElement(screen.getByRole('button', { name: 'Encerrar' }))
  rerender(
    <PainelShell {...base} supportAction={<button type="button">Encerrar</button>}>
      x
    </PainelShell>,
  )
  expect(screen.queryByRole('button', { name: 'Encerrar' })).toBeNull()
})

test('o tema chega ao elemento raiz', () => {
  render(<PainelShell {...base}>x</PainelShell>)
  const root = screen.getByTestId('painel-shell')
  expect(root).toHaveAttribute('data-scheme', 'day')
  expect(root.style.getPropertyValue('--brand').toUpperCase()).toBe(theme.vars['--brand'])
})

test('há um único h1 e o link de pular para o conteúdo', () => {
  render(
    <PainelShell {...base}>
      <ShellPage title="Agenda do dia">x</ShellPage>
    </PainelShell>,
  )
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Pular para o conteúdo' })).toHaveAttribute('href', '#conteudo')
})
