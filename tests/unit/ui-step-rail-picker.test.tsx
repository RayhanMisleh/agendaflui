// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarStylePicker } from '@/ui/components/SidebarStylePicker'
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
  expect(termos).toHaveTextContent('(com erro)')
  await userEvent.click(termos)
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('StepRail: o atual é caramelo, os já vistos são cheios e os futuros ficam vazios', () => {
  render(<StepRail steps={etapas} current={1} onSelect={() => {}} />)
  expect(screen.getByRole('link', { name: /Dados/ })).toHaveClass('af-steprail__link--done')
  expect(screen.getByRole('link', { name: /Marca/ })).toHaveClass('af-steprail__link--current')
  expect(screen.getByRole('link', { name: /Termos/ })).not.toHaveClass('af-steprail__link--done', 'af-steprail__link--current')
})

test('StepRail: sem JavaScript os itens são âncoras para a seção de cada etapa', () => {
  render(<StepRail steps={etapas} current={0} onSelect={() => {}} />)
  expect(screen.getByRole('link', { name: /Termos/ })).toHaveAttribute('href', '#etapa-termos')
})

test('SidebarStylePicker: grupo de opções com rótulo, uma marcada, nome para o formulário', async () => {
  const onChange = vi.fn()
  render(<SidebarStylePicker name="material" value="LEATHER" onChange={onChange} primary="#7A1F2B" accent="#E0A030" />)
  expect(screen.getByRole('radiogroup', { name: 'Barra lateral' })).toBeInTheDocument()
  expect(screen.getAllByRole('radio')).toHaveLength(4)
  expect(screen.getByRole('radio', { name: 'Cheia' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Cheia' })).toHaveAttribute('name', 'material')
  await userEvent.click(screen.getByRole('radio', { name: 'Noite' }))
  expect(onChange).toHaveBeenCalledWith('WOOD')
})

test('SidebarStylePicker: cada opção tem miniatura e descrição ligada por aria-describedby', () => {
  const { container } = render(<SidebarStylePicker name="material" value="LINEN" onChange={() => {}} primary="#0B6E66" accent="#F2A93B" />)
  expect(container.querySelectorAll('.af-sidepick__thumb')).toHaveLength(4)
  expect(screen.getByRole('radio', { name: 'Suave' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Clara' })).toHaveAccessibleDescription('Branca, com o item ativo em tom suave.')
})
