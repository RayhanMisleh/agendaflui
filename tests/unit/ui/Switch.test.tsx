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

function state(container: HTMLElement) {
  const track = container.querySelector('.af-switch__track') as HTMLElement
  return track.dataset.state
}

test('desligada: trilho "off"', () => {
  const { container } = render(<Switch checked={false} onCheckedChange={() => {}} label="Lembretes" />)
  expect(state(container)).toBe('off')
})

test('ligada: trilho "on"', () => {
  const { container } = render(<Switch checked onCheckedChange={() => {}} label="Lembretes" />)
  expect(state(container)).toBe('on')
})

test('o rótulo clica no interruptor', async () => {
  const onChange = vi.fn()
  render(<Switch checked={false} onCheckedChange={onChange} label="Lembretes" />)
  await userEvent.click(screen.getByText('Lembretes'))
  expect(onChange).toHaveBeenCalledWith(true)
})

test('desabilitada continua mostrando o estado real e não alterna', async () => {
  const onChange = vi.fn()
  const { container } = render(<Switch checked disabled onCheckedChange={onChange} label="Lembretes" />)
  expect(state(container)).toBe('on')
  await userEvent.click(screen.getByRole('switch'))
  expect(onChange).not.toHaveBeenCalled()
})
