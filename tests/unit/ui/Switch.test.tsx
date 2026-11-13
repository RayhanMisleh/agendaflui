// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from '@/ui/components'

test('alterna com teclado e expõe o estado', async () => {
  const onChange = vi.fn()
  render(<Switch checked={false} onCheckedChange={onChange} label="Lembretes" />)
  const sw = screen.getByRole('switch', { name: 'Lembretes' })
  expect(sw).toHaveAttribute('aria-checked', 'false')
  sw.focus()
  await userEvent.keyboard(' ')
  expect(onChange).toHaveBeenCalledWith(true)
})

test('Enter também alterna e desligar envia false', async () => {
  const onChange = vi.fn()
  render(<Switch checked onCheckedChange={onChange} label="Lembretes" />)
  const sw = screen.getByRole('switch', { name: 'Lembretes' })
  expect(sw).toHaveAttribute('aria-checked', 'true')
  sw.focus()
  await userEvent.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledWith(false)
})
