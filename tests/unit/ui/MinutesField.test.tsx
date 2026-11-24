// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MinutesField } from '@/ui/components'

function Caixa({ inicial }: { inicial: string }) {
  const [v, setV] = useState(inicial)
  return <MinutesField id="d" name="durationMin" value={v} onChange={setV} sumMin={90} />
}

test('MinutesField: "Usar a soma" só aparece quando o valor difere da soma e volta o valor para a soma', async () => {
  render(<Caixa inicial="47" />)
  expect(screen.getByText('Soma dos serviços: 1 h 30.')).toBeInTheDocument()
  const campo = screen.getByLabelText('Duração')
  expect(campo).toHaveAttribute('min', '5')
  expect(campo).toHaveAttribute('max', '720')
  await userEvent.click(screen.getByRole('button', { name: 'Usar a soma' }))
  expect(campo).toHaveValue(90)
  expect(screen.queryByRole('button', { name: 'Usar a soma' })).not.toBeInTheDocument()
})

test('com o valor igual à soma o botão não aparece', () => {
  render(<Caixa inicial="90" />)
  expect(screen.queryByRole('button', { name: 'Usar a soma' })).not.toBeInTheDocument()
})
