// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { Bubbles, Card } from '@/ui/components'

test('Card padrão é uma superfície sem variação', () => {
  render(<Card data-testid="c">Texto</Card>)
  const el = screen.getByTestId('c')
  expect(el.tagName).toBe('DIV')
  expect(el).toHaveClass('af-card')
  expect(el).not.toHaveClass('af-card--tint', 'af-card--warm', 'af-card--block')
})

test.each(['tint', 'warm', 'block'] as const)('variante %s', (variant) => {
  render(
    <Card data-testid="c" variant={variant}>
      Texto
    </Card>,
  )
  expect(screen.getByTestId('c')).toHaveClass('af-card', `af-card--${variant}`)
})

test('aceita outra tag', () => {
  render(
    <Card as="section" data-testid="c">
      Texto
    </Card>,
  )
  expect(screen.getByTestId('c').tagName).toBe('SECTION')
})

test('o bloco de destaque aceita as bolhas, escondidas do leitor de tela', () => {
  const { container } = render(
    <Card variant="block" bubbles data-testid="c">
      Hoje
    </Card>,
  )
  const bolhas = container.querySelector('.af-bubbles')
  expect(bolhas).not.toBeNull()
  expect(bolhas).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByTestId('c')).toHaveTextContent('Hoje')
})

test('sem a prop bubbles não há bolhas', () => {
  const { container } = render(<Card variant="block">Hoje</Card>)
  expect(container.querySelector('.af-bubbles')).toBeNull()
})

describe('Bubbles', () => {
  test('desenha três círculos por padrão, decorativos', () => {
    const { container } = render(<Bubbles />)
    const raiz = container.firstElementChild as HTMLElement
    expect(raiz).toHaveAttribute('aria-hidden', 'true')
    expect(raiz.querySelectorAll('.af-bubble')).toHaveLength(3)
  })

  test.each([2, 3, 4] as const)('count %s desenha esse tanto', (count) => {
    const { container } = render(<Bubbles count={count} />)
    expect(container.querySelectorAll('.af-bubble')).toHaveLength(count)
  })

  test('o fundo decide as cores', () => {
    const { container, rerender } = render(<Bubbles on="brand" />)
    expect(container.firstElementChild).toHaveClass('af-bubbles--on-brand')
    rerender(<Bubbles on="surface" />)
    expect(container.firstElementChild).toHaveClass('af-bubbles--on-surface')
  })
})
