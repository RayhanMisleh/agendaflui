// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { ClienteShell, ClienteSkeleton } from '@/ui/shells'

const rota = vi.hoisted(() => ({ path: '/loja-a/horarios' }))
vi.mock('next/navigation', () => ({ usePathname: () => rota.path }))

const loja = { name: 'Focinho Feliz', logoUrl: null, symbolUrl: null, slug: 'loja-a' }

function ver(o: { pets?: boolean; person?: { name: string } | null; hideTitle?: boolean } = {}) {
  return render(
    <ClienteShell store={loja} pets={o.pets ?? true} person={o.person === undefined ? { name: 'Marina Souza' } : o.person} title="Meus horários" {...(o.hideTitle ? { hideTitle: true } : {})}>
      <p>Conteúdo</p>
    </ClienteShell>,
  )
}

describe('ClienteShell', () => {
  test('um só h1, o título, e o conteúdo dentro do main', () => {
    ver()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Meus horários' })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByText('Conteúdo')).toBeInTheDocument()
  })

  test('hideTitle deixa o título só para o leitor de tela', () => {
    ver({ hideTitle: true })
    expect(screen.getByRole('heading', { level: 1, name: 'Meus horários' })).toHaveClass('af-sr')
  })

  test('navegação com o item da rota atual marcado, e o avatar leva a Mais', () => {
    ver()
    const navs = screen.getAllByRole('navigation', { name: 'Principal' })
    expect(navs).toHaveLength(2)
    for (const nav of navs) {
      expect(within(nav).getByRole('link', { name: 'Horários' })).toHaveAttribute('aria-current', 'page')
      expect(within(nav).getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
      expect(within(nav).getByRole('link', { name: 'Pets' })).toHaveAttribute('href', '/loja-a/pets')
    }
    expect(screen.getByRole('link', { name: 'Mais opções e Minha conta' })).toHaveAttribute('href', '/loja-a/mais')
  })

  test('sem nicho pet não há Pets; "feito com Agenda Flui" discreto no rodapé', () => {
    ver({ pets: false })
    expect(screen.queryByRole('link', { name: 'Pets' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Feito com Agenda Flui' })).toHaveAttribute('href', 'https://agendaflui.com.br')
  })

  test('o nome da loja leva ao início', () => {
    ver()
    expect(screen.getByRole('link', { name: 'Focinho Feliz' })).toHaveAttribute('href', '/loja-a')
  })
})

test.each(['inicio', 'lista', 'detalhe', 'fluxo', 'grade'] as const)('ClienteSkeleton %s anuncia carregamento e não leva nome de transição', (variant) => {
  const { container } = render(<ClienteSkeleton variant={variant} />)
  expect(screen.getByRole('status')).toHaveTextContent('Carregando')
  expect(container.querySelector('.af-cl-shell')).toHaveClass('af-shell--skeleton')
  expect(container.querySelectorAll('.af-skel').length).toBeGreaterThan(3)
})
