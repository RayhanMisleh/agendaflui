// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/ui/components'

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

test('clique chama o manipulador e o tipo padrão é button', async () => {
  const onClick = vi.fn()
  render(<Button onClick={onClick}>Salvar</Button>)
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
})
