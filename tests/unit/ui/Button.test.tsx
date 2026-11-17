// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, LinkButton } from '@/ui/components'

test('loading desabilita e avisa', async () => {
  const onClick = vi.fn()
  render(
    <Button loading onClick={onClick}>
      Salvar
    </Button>,
  )
  await userEvent.click(screen.getByRole('button'))
  expect(onClick).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
})

test('carregando mantém o texto no lugar (a largura não muda) e põe o anel', () => {
  const { container } = render(<Button loading>Salvar</Button>)
  expect(screen.getByRole('button')).toHaveTextContent('Salvar')
  expect(container.querySelector('.af-button__spinner')).not.toBeNull()
})

test('clique chama o manipulador e o tipo padrão é button', async () => {
  const onClick = vi.fn()
  render(<Button onClick={onClick}>Salvar</Button>)
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
})

test.each(['primary', 'secondary', 'ghost', 'danger', 'accent'] as const)('variante %s vira classe', (variant) => {
  render(<Button variant={variant}>Ação</Button>)
  expect(screen.getByRole('button')).toHaveClass('af-button', `af-button--${variant}`, 'af-button--md')
})

test.each(['sm', 'md', 'lg'] as const)('tamanho %s vira classe', (size) => {
  render(<Button size={size}>Ação</Button>)
  expect(screen.getByRole('button')).toHaveClass(`af-button--${size}`)
})

test('LinkButton é um link com a mesma aparência, inclusive a variante accent', () => {
  render(
    <LinkButton href="/agenda" variant="accent">
      Abrir agenda
    </LinkButton>,
  )
  const link = screen.getByRole('link', { name: 'Abrir agenda' })
  expect(link).toHaveAttribute('href', '/agenda')
  expect(link).toHaveClass('af-button', 'af-button--accent')
})
