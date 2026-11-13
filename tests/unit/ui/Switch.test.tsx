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
  const visible = Array.from(track.querySelectorAll<HTMLElement>('[data-mark]'))
    .filter((m) => !m.hidden)
    .map((m) => m.dataset.mark)
  return { state: track.dataset.state, visible }
}

test('desligada mostra o símbolo O e só ele', () => {
  const { container } = render(<Switch checked={false} onCheckedChange={() => {}} label="Lembretes" />)
  expect(state(container)).toEqual({ state: 'off', visible: ['off'] })
})

test('ligada mostra o símbolo I e só ele', () => {
  const { container } = render(<Switch checked onCheckedChange={() => {}} label="Lembretes" />)
  expect(state(container)).toEqual({ state: 'on', visible: ['on'] })
})

test('desabilitada continua mostrando o estado real', () => {
  const { container } = render(<Switch checked disabled onCheckedChange={() => {}} label="Lembretes" />)
  expect(state(container)).toEqual({ state: 'on', visible: ['on'] })
})
