// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaterialPicker } from '@/ui/components/MaterialPicker'
import { StepRail } from '@/ui/components/StepRail'

const etapas = [
  { id: 'dados', label: 'Dados' },
  { id: 'marca', label: 'Marca' },
  { id: 'termos', label: 'Termos' },
]

test('StepRail: a etapa atual leva aria-current="step" e a lista tem nome', () => {
  render(<StepRail steps={etapas} current={1} onSelect={() => {}} />)
  expect(screen.getByRole('navigation', { name: 'Etapas da criação da conta' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Marca/ })).toHaveAttribute('aria-current', 'step')
  expect(screen.getByRole('link', { name: /Dados/ })).not.toHaveAttribute('aria-current')
})

test('StepRail: etapa com erro diz "com erro" em texto, e escolher chama onSelect sem navegar', async () => {
  const onSelect = vi.fn()
  render(<StepRail steps={etapas} current={0} onSelect={onSelect} errorSteps={[2]} />)
  const termos = screen.getByRole('link', { name: /Termos/ })
  expect(termos).toHaveAccessibleName(/com erro/)
  await userEvent.click(termos)
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('StepRail: sem JavaScript os itens são âncoras para a seção de cada etapa', () => {
  render(<StepRail steps={etapas} current={0} onSelect={() => {}} />)
  expect(screen.getByRole('link', { name: /Termos/ })).toHaveAttribute('href', '#etapa-termos')
})

test('MaterialPicker: grupo de opções com rótulo, uma marcada, nome para o formulário', async () => {
  const onChange = vi.fn()
  render(<MaterialPicker name="material" value="LEATHER" onChange={onChange} primary="#7A1F2B" accent="#E0A030" paper="CREAM" fontPair="CLASSIC" />)
  expect(screen.getByRole('radiogroup', { name: 'Barra lateral' })).toBeInTheDocument()
  expect(screen.getAllByRole('radio')).toHaveLength(4)
  expect(screen.getByRole('radio', { name: 'Cheia' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Cheia' })).toHaveAttribute('name', 'material')
  await userEvent.click(screen.getByRole('radio', { name: 'Noite' }))
  expect(onChange).toHaveBeenCalledWith('WOOD')
})
