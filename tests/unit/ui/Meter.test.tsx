// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { Meter } from '@/ui/components'

test('é um medidor com valor, limites e texto', () => {
  render(<Meter value={0.98} label="Requisições sem erro" display="98%" />)
  const m = screen.getByRole('meter', { name: 'Requisições sem erro' })
  expect(m).toHaveAttribute('aria-valuenow', '0.98')
  expect(m).toHaveAttribute('aria-valuemin', '0')
  expect(m).toHaveAttribute('aria-valuemax', '1')
  expect(m).toHaveAttribute('aria-valuetext', '98%')
  expect(screen.getByText('98%')).toBeInTheDocument()
})

test('valor fora de 0 a 1 é preso nos limites e NaN vira 0', () => {
  const { rerender } = render(<Meter value={3} label="Uso" display="300%" />)
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '1')
  rerender(<Meter value={Number.NaN} label="Uso" display="?" />)
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0')
})

test('passou do alerta: preenchimento em accent, dito em texto', () => {
  const { container, rerender } = render(<Meter value={0.5} alertAt={0.8} label="Uso do plano" display="50%" />)
  expect(container.firstElementChild).not.toHaveClass('af-meter--alert')
  rerender(<Meter value={0.85} alertAt={0.8} label="Uso do plano" display="85%" />)
  expect(container.firstElementChild).toHaveClass('af-meter--alert')
  expect(screen.getByText('Acima do limite de alerta')).toBeInTheDocument()
})
