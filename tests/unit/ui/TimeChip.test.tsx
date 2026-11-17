// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimeChip } from '@/ui/components'

test('livre: botão que avisa quando é escolhido', async () => {
  const onSelect = vi.fn()
  render(<TimeChip time="09:00" onSelect={onSelect} />)
  const chip = screen.getByRole('button', { name: '09:00' })
  expect(chip).toHaveClass('af-timechip', 'af-timechip--free')
  expect(chip).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(chip)
  expect(onSelect).toHaveBeenCalledWith('09:00')
})

test('escolhido: aria-pressed e classe', () => {
  render(<TimeChip time="10:00" state="selected" />)
  const chip = screen.getByRole('button', { name: '10:00' })
  expect(chip).toHaveAttribute('aria-pressed', 'true')
  expect(chip).toHaveClass('af-timechip--selected')
})

test('ocupado: desabilitado, não chama o manipulador e diz "ocupado" em texto', async () => {
  const onSelect = vi.fn()
  render(<TimeChip time="09:30" state="busy" onSelect={onSelect} />)
  const chip = screen.getByRole('button', { name: '09:30, ocupado' })
  expect(chip).toBeDisabled()
  await userEvent.click(chip)
  expect(onSelect).not.toHaveBeenCalled()
  expect(chip).toHaveClass('af-timechip--busy')
})
