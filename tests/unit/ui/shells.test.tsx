// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { CalendarDays, Users } from 'lucide-react'
import { BrandMark, DevShell, EntryScreen, PainelShell, ShellPage } from '@/ui/shells'
import { deriveTheme } from '@/ui/theme/derive'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'

const nav = [
  { href: '/agenda', label: 'Agenda', icon: CalendarDays, active: true },
  { href: '/clientes', label: 'Clientes', icon: Users },
]
const user = { name: 'Marina Lopes', roleLabel: 'Dona', avatarUrl: null }
const painel = (material: 'LEATHER' | 'LINEN' | 'WOOD' | 'ENAMEL') => ({
  theme: deriveTheme({ ...AGENDAFLUI_BRAND, material }),
  brand: { name: 'Patas e Pelos', logoUrl: null, symbolUrl: null },
  nav,
  user,
})

describe('moldura do painel do negócio', () => {
  test.each([
    ['LEATHER', 'dark'],
    ['LINEN', 'light'],
    ['WOOD', 'dark'],
    ['ENAMEL', 'light'],
  ] as const)('barra %s é %s', (material, tom) => {
    render(<PainelShell {...painel(material)}>x</PainelShell>)
    expect(screen.getByTestId('painel-shell').firstElementChild).toHaveClass(`af-shell--bar-${tom}`)
  })

  test('a ação da conta (Sair) fica no pé da barra, não no cabeçalho da página', () => {
    render(
      <PainelShell {...painel('LEATHER')} accountActions={<button type="button">Sair</button>}>
        <ShellPage title="Agenda do dia" actions={<button type="button">Nova</button>}>
          x
        </ShellPage>
      </PainelShell>,
    )
    const pe = screen.getByRole('contentinfo')
    expect(within(pe).getByRole('button', { name: 'Sair' })).toBeInTheDocument()
    expect(within(pe).getByText('Marina Lopes')).toBeInTheDocument()
    expect(within(pe).getByText('Dona')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toContainElement(screen.getByRole('button', { name: 'Nova' }))
  })

  test('o menu da conta do celular existe com nome acessível', () => {
    render(<PainelShell {...painel('LEATHER')}>x</PainelShell>)
    expect(screen.getByRole('button', { name: 'Menu da conta' })).toBeInTheDocument()
  })

  test('a bolha do pé só existe na barra Cheia', () => {
    const { container, rerender } = render(<PainelShell {...painel('LEATHER')}>x</PainelShell>)
    expect(container.querySelector('.af-shell__bubble')).not.toBeNull()
    rerender(<PainelShell {...painel('ENAMEL')}>x</PainelShell>)
    expect(container.querySelector('.af-shell__bubble')).toBeNull()
  })

  test('a faixa de suporte vem antes da moldura, com o botão Encerrar', () => {
    const { container } = render(
      <PainelShell {...painel('LEATHER')} supportBanner="Você está em modo suporte na conta Patas e Pelos" supportAction={<button type="button">Encerrar</button>}>
        x
      </PainelShell>,
    )
    const faixa = screen.getByRole('note')
    expect(faixa).toHaveTextContent('Você está em modo suporte na conta Patas e Pelos')
    const frame = container.querySelector('.af-shell__frame')!
    expect(faixa.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('nada do estilo antigo no DOM', () => {
    const { container } = render(<PainelShell {...painel('LEATHER')}>x</PainelShell>)
    expect(container.innerHTML).not.toMatch(/af-(cover|stitched|engraved|on-cover-text|material-metal|divider)/)
  })

  test('o destino ativo tem aria-current e os 5+ destinos viram "Mais"', () => {
    const muitos = Array.from({ length: 7 }, (_, i) => ({ href: `/p${i}`, label: `Tela ${i}`, icon: Users, active: i === 0 }))
    render(<PainelShell {...painel('LEATHER')} nav={muitos}>x</PainelShell>)
    expect(screen.getAllByRole('link', { name: 'Tela 0' })[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Mais' })).toBeInTheDocument()
  })
})

describe('moldura do painel dev', () => {
  test('tema noite exato, marca em negativo e Meu perfil no pé', () => {
    const { container } = render(
      <DevShell nav={nav} admin={{ name: 'Admin Flui' }} accountActions={<a href="/perfil">Meu perfil</a>}>
        x
      </DevShell>,
    )
    const raiz = screen.getByTestId('dev-shell')
    expect(raiz).toHaveAttribute('data-scheme', 'night')
    expect(raiz.getAttribute('style') ?? '').not.toMatch(/--brand/)
    expect(container.querySelector('.af-brand--negative')).not.toBeNull()
    const pe = screen.getByRole('contentinfo')
    expect(within(pe).getByRole('link', { name: 'Meu perfil' })).toBeInTheDocument()
    expect(within(pe).getByText('Admin Flui')).toBeInTheDocument()
  })
})

describe('BrandMark sobre a cor da conta', () => {
  test('on-color desenha o símbolo com as variáveis da cor, sem hex da marca no corpo', () => {
    const { container } = render(<BrandMark name="Agenda Flui" logoUrl={null} size="lg" platform variant="on-color" />)
    expect(container.querySelector('.af-brand--on-color')).not.toBeNull()
    expect(container.querySelector('svg rect')?.getAttribute('style')).toContain('var(--mark-ink')
  })
})

describe('tela de entrada', () => {
  const theme = deriveTheme(AGENDAFLUI_BRAND)
  const brand = { name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }

  test('duas partes: destaque com a frase e cartão com o formulário', () => {
    const { container } = render(
      <EntryScreen theme={theme} brand={brand} headline="A agenda que flui." title="Entrar na agenda">
        <button type="button">Entrar</button>
      </EntryScreen>,
    )
    const destaque = container.querySelector('.af-entry__hero')!
    expect(destaque).toHaveTextContent('A agenda que flui.')
    expect(destaque.querySelector('.af-bubbles')).not.toBeNull()
    expect(destaque.querySelector('.af-bubbles')).toHaveAttribute('aria-hidden', 'true')
    const cartao = container.querySelector('.af-entry__card')!
    expect(within(cartao as HTMLElement).getByRole('heading', { level: 1, name: 'Entrar na agenda' })).toBeInTheDocument()
    expect(cartao).toContainElement(screen.getByRole('button', { name: 'Entrar' }))
  })

  test('na entrada de uma conta, o destaque traz o nome dela e a mensagem de entrada', () => {
    const { container } = render(
      <EntryScreen theme={theme} brand={{ name: 'Patas & Cia', logoUrl: null, symbolUrl: null }} headline="Patas & Cia" lede="Bem-vindo de volta." title="Entrar na agenda">
        x
      </EntryScreen>,
    )
    const destaque = container.querySelector('.af-entry__hero') as HTMLElement
    expect(within(destaque).getByText('Bem-vindo de volta.')).toBeInTheDocument()
    expect(destaque.querySelector('.af-entry__headline')).toHaveTextContent('Patas & Cia')
  })

  test('painel dev: tema noite e nada de estilo antigo', () => {
    const { container } = render(
      <EntryScreen variant="dev" theme={theme} brand={brand} headline="Painel da plataforma" title="Entrar no painel" testId="dev-entry">
        x
      </EntryScreen>,
    )
    expect(screen.getByTestId('dev-entry')).toHaveAttribute('data-scheme', 'night')
    expect(container.innerHTML).not.toMatch(/af-(cover|stitched|engraved|on-cover-text|material-metal)/)
  })
})

describe('página dentro da moldura', () => {
  test('a moldura não traz título: o cabeçalho é da página e as ações ficam ao lado dele', () => {
    render(<PainelShell {...painel('LEATHER')}>x</PainelShell>)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByRole('main')).toHaveTextContent('x')
  })

  test('trocar só a página mantém a moldura (barra, menu e usuário) no mesmo lugar do DOM', () => {
    const { rerender } = render(
      <PainelShell {...painel('LEATHER')}>
        <ShellPage title="Agenda">primeira</ShellPage>
      </PainelShell>,
    )
    const barra = screen.getByRole('navigation', { name: 'Principal' })
    const raiz = screen.getByTestId('painel-shell')
    rerender(
      <PainelShell {...painel('LEATHER')}>
        <ShellPage title="Clientes">segunda</ShellPage>
      </PainelShell>,
    )
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBe(barra)
    expect(screen.getByTestId('painel-shell')).toBe(raiz)
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('segunda')
  })

  test('com headingLevel 2 o título da página vira h2 (moldura embutida na vitrine)', () => {
    render(
      <PainelShell {...painel('LEATHER')} embedded label="Início">
        <ShellPage title="Início" headingLevel={2}>
          x
        </ShellPage>
      </PainelShell>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Início' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Início' })).toBeInTheDocument()
  })
})
