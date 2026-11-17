// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MiniBars } from '@/ui/components/MiniBars'
import { Sparkline } from '@/ui/components/Sparkline'
import { StatTile } from '@/ui/components/StatTile'
import { describeTrend } from '@/ui/components/trend'

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`

describe('describeTrend', () => {
  test('para cima: diz quantos a mais, em texto, sobre o mesmo período do mês passado', () => {
    const t = describeTrend({ current: 20, previousSamePeriod: 8, previous: 30 })
    expect(t.direction).toBe('up')
    expect(t.text).toBe('12 a mais que no mesmo período do mês passado')
    expect(t.reference).toBe('Mês passado inteiro: 30')
  })

  test('para baixo e igual', () => {
    expect(describeTrend({ current: 5, previousSamePeriod: 13, previous: 13 })).toMatchObject({
      direction: 'down',
      text: '8 a menos que no mesmo período do mês passado',
    })
    expect(describeTrend({ current: 7, previousSamePeriod: 7, previous: 9 })).toMatchObject({
      direction: 'same',
      text: 'igual ao mesmo período do mês passado',
    })
  })

  test('sem nada nos dois lados é igual; sem base de comparação não inventa porcentagem', () => {
    expect(describeTrend({ current: 0, previousSamePeriod: 0, previous: 0 }).direction).toBe('same')
    const t = describeTrend({ current: 4, previousSamePeriod: 0, previous: 0 })
    expect(t.text).toBe('4 a mais que no mesmo período do mês passado')
    expect(t.text).not.toMatch(/%|Infinity|NaN/)
  })

  test('usa o formatador para dinheiro', () => {
    const t = describeTrend({ current: 25_000, previousSamePeriod: 13_000, previous: 40_000 }, reais)
    expect(t.text).toBe('R$ 120,00 a mais que no mesmo período do mês passado')
    expect(t.reference).toBe('Mês passado inteiro: R$ 400,00')
  })
})

describe('StatTile', () => {
  test('mostra rótulo, valor e a tendência em texto, com seta que não é a única pista', () => {
    render(<StatTile label="Agendamentos no mês" value={1234} trend={describeTrend({ current: 20, previousSamePeriod: 8, previous: 30 })} />)
    expect(screen.getByRole('group', { name: 'Agendamentos no mês' })).toBeInTheDocument()
    expect(screen.getByText('1.234')).toBeInTheDocument()
    const tendencia = screen.getByText('12 a mais que no mesmo período do mês passado')
    expect(tendencia).toBeVisible()
    expect(tendencia.closest('[data-direction]')).toHaveAttribute('data-direction', 'up')
    expect(screen.getByText('Mês passado inteiro: 30')).toBeInTheDocument()
    // A seta é decoração: o leitor de tela lê o texto.
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  test('para baixo e igual têm texto próprio', () => {
    const { rerender } = render(<StatTile label="Clientes novos" value={5} trend={describeTrend({ current: 5, previousSamePeriod: 13, previous: 13 })} />)
    expect(screen.getByText('8 a menos que no mesmo período do mês passado').closest('[data-direction]')).toHaveAttribute('data-direction', 'down')
    rerender(<StatTile label="Clientes novos" value={7} trend={describeTrend({ current: 7, previousSamePeriod: 7, previous: 7 })} />)
    expect(screen.getByText('igual ao mesmo período do mês passado').closest('[data-direction]')).toHaveAttribute('data-direction', 'same')
  })

  test('receita sai em reais; sem tendência não mostra linha de tendência', () => {
    render(<StatTile label="Receita do mês" value={123456} format="brl" />)
    expect(screen.getByText('R$ 1.234,56')).toBeInTheDocument()
    expect(document.querySelector('[data-direction]')).toBeNull()
  })
})

describe('Sparkline', () => {
  test('é uma imagem com nome e descrição que trazem os números', () => {
    render(<Sparkline values={[3, 5, 2, 8]} label="Pedidos por dia" />)
    const img = screen.getByRole('img', { name: /Pedidos por dia/ })
    expect(img.getAttribute('aria-label')).toMatch(/3, 5, 2, 8/)
    expect(img.querySelector('title')?.textContent).toMatch(/Pedidos por dia/)
    expect(img.querySelector('path')?.getAttribute('d')).not.toMatch(/NaN/)
  })

  test('série vazia e série de um ponto não quebram', () => {
    const { rerender } = render(<Sparkline values={[]} label="Sem dados" />)
    expect(screen.getByRole('img', { name: /Sem dados.*nenhum valor/i })).toBeInTheDocument()
    rerender(<Sparkline values={[4]} label="Um ponto" />)
    const img = screen.getByRole('img', { name: /Um ponto/ })
    expect(img.outerHTML).not.toMatch(/NaN|Infinity/)
  })
})

describe('MiniBars', () => {
  test('cada barra tem rótulo e valor em texto na descrição', () => {
    render(<MiniBars label="Agendamentos" bars={[{ label: 'Mês passado', value: 30 }, { label: 'Este mês', value: 20 }]} />)
    const img = screen.getByRole('img', { name: /Agendamentos/ })
    expect(img.getAttribute('aria-label')).toMatch(/Mês passado: 30/)
    expect(img.getAttribute('aria-label')).toMatch(/Este mês: 20/)
    expect(img.querySelector('title')).not.toBeNull()
  })

  test('tudo zero ou lista vazia não gera NaN', () => {
    const { container, rerender } = render(<MiniBars label="Zeros" bars={[{ label: 'A', value: 0 }, { label: 'B', value: 0 }]} />)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
    rerender(<MiniBars label="Vazio" bars={[]} />)
    expect(screen.getByRole('img', { name: /Vazio/ })).toBeInTheDocument()
  })
})
