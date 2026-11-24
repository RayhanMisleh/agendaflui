// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { NavTabs } from '@/ui/components/NavTabs'
import { SearchBar } from '@/ui/components/SearchBar'

vi.mock('next/navigation', () => ({ usePathname: () => '/contas', useSearchParams: () => new URLSearchParams() }))

describe('NavTabs com filtro por parâmetro da URL', () => {
  const itens = [
    { id: 'todas', label: 'Todas', href: '/contas', active: false },
    { id: 'ativas', label: 'Ativas', href: '/contas?status=ACTIVE', active: true },
    { id: 'suspensas', label: 'Suspensas', href: '/contas?status=SUSPENDED', active: false },
  ]

  test('`active` explícito decide a aba atual, mesmo com o mesmo caminho', () => {
    render(<NavTabs label="Situação" items={itens} />)
    expect(screen.getByRole('link', { name: 'Ativas' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Todas' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Suspensas' })).not.toHaveAttribute('aria-current')
  })

  test('sem `active`, a rota decide, como antes', () => {
    render(<NavTabs label="Abas" items={[{ id: 'a', label: 'Resumo', href: '/contas', exact: true }, { id: 'b', label: 'Outra', href: '/outra' }]} />)
    expect(screen.getByRole('link', { name: 'Resumo' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Outra' })).not.toHaveAttribute('aria-current')
  })
})

describe('SearchBar em pílula', () => {
  test('a busca é uma pílula com lupa e rótulo acessível', () => {
    const { container } = render(<SearchBar action="/contas" label="Buscar contas" query="pata" filters={[]} clearHref="/contas" />)
    expect(container.querySelector('.af-searchbar__box .af-searchbar__icon')).not.toBeNull()
    expect(screen.getByLabelText('Buscar contas')).toHaveClass('af-searchbar__input')
    expect(screen.getByLabelText('Buscar contas')).toHaveValue('pata')
  })

  test('campos escondidos mantêm o filtro ao buscar', () => {
    const { container } = render(<SearchBar action="/contas" label="Buscar contas" query="" filters={[]} hidden={{ status: 'ACTIVE' }} clearHref="/contas" />)
    const h = container.querySelector('input[type="hidden"][name="status"]')
    expect(h).toHaveAttribute('value', 'ACTIVE')
  })
})

describe('FoldablePreview', () => {
  test('o botão recolhe e abre a prévia e diz o estado em texto', async () => {
    const { FoldablePreview } = await import('@/ui/components/FoldablePreview')
    const { default: userEvent } = await import('@testing-library/user-event')
    render(
      <FoldablePreview>
        <p>conteúdo da prévia</p>
      </FoldablePreview>,
    )
    const botao = screen.getByRole('button', { name: /prévia/i })
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('conteúdo da prévia')).toBeInTheDocument()
    await userEvent.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(botao).toHaveTextContent('Mostrar a prévia')
    expect(botao.closest('aside')).toHaveAttribute('data-open', 'false')
    // o conteúdo continua no HTML (o CSS é quem o esconde no celular)
    expect(screen.getByText('conteúdo da prévia')).toBeInTheDocument()
    await userEvent.click(botao)
    expect(botao).toHaveTextContent('Esconder a prévia')
  })
})
