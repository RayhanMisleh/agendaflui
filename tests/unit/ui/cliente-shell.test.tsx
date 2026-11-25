// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { ClientePagina, ClienteShell, ClienteSkeleton } from '@/ui/shells'

const rota = vi.hoisted(() => ({ path: '/loja-a/horarios' }))
vi.mock('next/navigation', () => ({ usePathname: () => rota.path }))

const loja = { name: 'Focinho Feliz', logoUrl: null, symbolUrl: null, slug: 'loja-a' }

function ver(o: { pets?: boolean; person?: { name: string } | null; path?: string } = {}) {
  rota.path = o.path ?? '/loja-a/horarios'
  return render(
    <ClienteShell store={loja} pets={o.pets ?? true} person={o.person === undefined ? { name: 'Marina Souza' } : o.person}>
      <ClientePagina title="Meus horários">
        <p>Conteúdo</p>
      </ClientePagina>
    </ClienteShell>,
  )
}

describe('ClienteShell (a moldura do layout)', () => {
  test('a moldura não desenha título: o h1 é da página, dentro do main', () => {
    ver()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1, name: 'Meus horários' })).toBeInTheDocument()
    expect(within(main).getByText('Conteúdo')).toBeInTheDocument()
  })

  test('sem página dentro, a moldura sozinha não tem título', () => {
    render(
      <ClienteShell store={loja} pets person={{ name: 'Marina Souza' }}>
        <p>Só o miolo</p>
      </ClienteShell>,
    )
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(within(screen.getByRole('main')).getByText('Só o miolo')).toBeInTheDocument()
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

  test('sem nicho pet não há Pets', () => {
    ver({ pets: false })
    expect(screen.queryByRole('link', { name: 'Pets' })).toBeNull()
  })

  test('o nome da loja leva ao início', () => {
    ver()
    expect(screen.getByRole('link', { name: 'Focinho Feliz' })).toHaveAttribute('href', '/loja-a')
  })

  test('tela de fluxo (agendar, boas-vindas, remarcar): some a navegação da base e o main fica imersivo', () => {
    ver({ path: '/loja-a/agendar' })
    expect(screen.getAllByRole('navigation', { name: 'Principal' })).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveClass('af-cl-main--immersive')
  })

  test('tela comum tem a navegação da base e o main sem a marca de fluxo', () => {
    ver({ path: '/loja-a/pets' })
    expect(screen.getAllByRole('navigation', { name: 'Principal' })).toHaveLength(2)
    expect(screen.getByRole('main')).not.toHaveClass('af-cl-main--immersive')
  })

  test('a mesma moldura segue montada quando só a rota muda (o menu não remonta)', () => {
    const { rerender } = ver({ path: '/loja-a/horarios' })
    const marca = screen.getByRole('link', { name: 'Focinho Feliz' })
    const nav = screen.getAllByRole('navigation', { name: 'Principal' })[0]
    rota.path = '/loja-a/pets'
    rerender(
      <ClienteShell store={loja} pets person={{ name: 'Marina Souza' }}>
        <ClientePagina title="Pets">
          <p>Outro</p>
        </ClientePagina>
      </ClienteShell>,
    )
    expect(screen.getByRole('link', { name: 'Focinho Feliz' })).toBe(marca)
    expect(screen.getAllByRole('navigation', { name: 'Principal' })[0]).toBe(nav)
    expect(within(nav as HTMLElement).getByRole('link', { name: 'Pets' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('ClientePagina (o miolo)', () => {
  test('um só h1; hideTitle o deixa só para o leitor de tela', () => {
    render(
      <ClientePagina title="Início" hideTitle>
        <p>x</p>
      </ClientePagina>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toHaveClass('af-sr')
  })

  test('voltar, ações e "feito com Agenda Flui" ficam no miolo', () => {
    render(
      <ClientePagina title="Pedido" back={{ href: '/loja-a/loja', label: 'Loja' }} actions={<button type="button">Ação</button>}>
        <p>x</p>
      </ClientePagina>,
    )
    expect(screen.getByRole('link', { name: 'Loja' })).toHaveAttribute('href', '/loja-a/loja')
    expect(screen.getByRole('button', { name: 'Ação' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Feito com Agenda Flui' })).toHaveAttribute('href', 'https://agendaflui.com.br')
  })
})

test.each(['inicio', 'lista', 'detalhe', 'fluxo', 'grade'] as const)('ClienteSkeleton %s é só o miolo: anuncia carregamento e não desenha menu nem barra', (variant) => {
  const { container } = render(<ClienteSkeleton variant={variant} />)
  expect(screen.getByRole('status')).toHaveTextContent('Carregando')
  expect(container.querySelector('.af-cl-shell, .af-cl-top, .af-cl-nav, nav, header')).toBeNull()
  expect(container.querySelectorAll('.af-skel').length).toBeGreaterThan(3)
})
