// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PremioCartao, avisoDeEstoque, type PremioDoCartao } from '@/app/app/[slug]/(area)/premios/_lib/PremioCartao'
import { Ranking } from '@/app/app/[slug]/(area)/premios/_lib/Ranking'
import { Saldo } from '@/app/app/[slug]/(area)/premios/_lib/Saldo'
import { ToastProvider } from '@/ui/components'

vi.mock('@/app/app/[slug]/(area)/premios/actions', () => ({ resgatarPremio: vi.fn(), cancelarResgate: vi.fn() }))

const premio: PremioDoCartao = { id: 'p1', name: 'Corte grátis', description: 'Um corte à escolha', imageUrl: null, costPoints: 100, stock: null }

function ver(balance: number, p = premio) {
  return render(
    <ToastProvider>
      <ul>
        <PremioCartao slug="loja-a" prize={p} balance={balance} />
      </ul>
    </ToastProvider>,
  )
}

describe('PremioCartao', () => {
  test('sem saldo: "Faltam 40 pontos" e botão desabilitado', () => {
    ver(60)
    const botao = screen.getByRole('button', { name: 'Faltam 40 pontos' })
    expect(botao).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Resgatar' })).toBeNull()
  })

  test('falta 1 ponto: "Faltam 1 ponto"', () => {
    ver(99)
    expect(screen.getByRole('button', { name: 'Faltam 1 ponto' })).toBeDisabled()
  })

  test('com saldo: Resgatar abre a confirmação com o valor e o saldo que fica, e leva o custo e a chave', () => {
    ver(130)
    fireEvent.click(screen.getByRole('button', { name: 'Resgatar' }))
    const dialogo = screen.getByRole('dialog', { name: 'Resgatar prêmio', hidden: true })
    expect(within(dialogo).getByText('Resgatar Corte grátis por 100 pontos? Seu saldo fica em 30 pontos.')).toBeInTheDocument()
    expect((dialogo.querySelector('input[name="prizeId"]') as HTMLInputElement).value).toBe('p1')
    expect((dialogo.querySelector('input[name="expectedCostPoints"]') as HTMLInputElement).value).toBe('100')
    expect((dialogo.querySelector('input[name="key"]') as HTMLInputElement).value).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('estoque baixo avisa; sem limite ou com bastante, não', () => {
    expect(avisoDeEstoque(3)).toBe('Últimas 3 unidades')
    expect(avisoDeEstoque(1)).toBe('Última unidade')
    expect(avisoDeEstoque(4)).toBeNull()
    expect(avisoDeEstoque(null)).toBeNull()
    ver(200, { ...premio, stock: 2 })
    expect(screen.getByText('Últimas 2 unidades')).toBeInTheDocument()
  })
})

describe('Saldo', () => {
  test('saldo 1 → "1 ponto"; saldo 0 → "0 pontos"', () => {
    const { rerender } = render(<Saldo slug="loja-a" balance={1} clubMember={false} />)
    expect(screen.getByText('1 ponto')).toBeInTheDocument()
    rerender(<Saldo slug="loja-a" balance={0} clubMember={false} />)
    expect(screen.getByText('0 pontos')).toBeInTheDocument()
  })

  test('do Clube: selo "Você é do Clube"; o extrato é um link', () => {
    render(<Saldo slug="loja-a" balance={120} clubMember />)
    expect(screen.getByText('Você é do Clube')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver extrato' })).toHaveAttribute('href', '/loja-a/premios/extrato')
  })
})

describe('Ranking', () => {
  test('a linha do cliente vem destacada e dita em texto', () => {
    render(
      <Ranking
        entries={[
          { position: 1, firstName: 'Bia', avatarUrl: null, points: 90 },
          { position: 2, firstName: 'Maria', avatarUrl: null, points: 10, isYou: true },
        ]}
      />,
    )
    expect(screen.getByRole('listitem', { name: 'Você, 2º lugar' })).toHaveClass('is-you')
    expect(screen.getByText('Maria (você)')).toBeInTheDocument()
    expect(screen.getByText('90 pontos')).toBeInTheDocument()
  })

  test('sem linhas não desenha nada', () => {
    const { container } = render(<Ranking entries={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
