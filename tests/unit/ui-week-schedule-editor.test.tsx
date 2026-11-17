// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WeekScheduleEditor, weekFromMinutes } from '@/ui/components'

const SEMANA = { MONDAY: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '18:00' }], SATURDAY: [{ start: '09:00', end: '13:00' }] }

function valores(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const el of container.querySelectorAll<HTMLInputElement>('input[name]')) out[el.name] = el.value
  return out
}

test('serializa cada faixa em campos HH:mm com o dia, o número e o lado', () => {
  const { container } = render(<WeekScheduleEditor defaultValue={SEMANA} />)
  expect(valores(container)).toMatchObject({
    'MONDAY.0.start': '09:00',
    'MONDAY.0.end': '12:00',
    'MONDAY.1.start': '13:30',
    'MONDAY.1.end': '18:00',
    'SATURDAY.0.start': '09:00',
    'SATURDAY.0.end': '13:00',
  })
  expect(Object.keys(valores(container)).some((k) => k.startsWith('SUNDAY'))).toBe(false)
})

test('copia a segunda para os outros dias e substitui o que havia', async () => {
  const { container } = render(<WeekScheduleEditor defaultValue={SEMANA} />)
  await userEvent.click(screen.getByRole('button', { name: 'Copiar segunda-feira para os outros dias' }))
  const v = valores(container)
  for (const dia of ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']) {
    expect(v[`${dia}.0.start`], dia).toBe('09:00')
    expect(v[`${dia}.0.end`], dia).toBe('12:00')
    expect(v[`${dia}.1.start`], dia).toBe('13:30')
    expect(v[`${dia}.1.end`], dia).toBe('18:00')
    expect(v[`${dia}.2.start`], dia).toBeUndefined()
  }
})

test('adiciona e remove faixas; dia sem faixa aparece como fechado', async () => {
  const { container } = render(<WeekScheduleEditor defaultValue={{ MONDAY: [{ start: '09:00', end: '12:00' }] }} />)
  expect(screen.getAllByText('Fechado')).toHaveLength(6)
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar faixa na terça-feira' }))
  expect(valores(container)['TUESDAY.0.start']).toBe('09:00')
  await userEvent.click(screen.getByRole('button', { name: 'Remover faixa 1 de segunda-feira' }))
  expect(valores(container)['MONDAY.0.start']).toBeUndefined()
  expect(screen.getAllByText('Fechado')).toHaveLength(6)
})

test('o erro de uma faixa aparece junto dela e marca o campo', () => {
  render(<WeekScheduleEditor defaultValue={SEMANA} errors={{ 'MONDAY.1.end': 'O fim deve ser depois do início.', SATURDAY: 'Os intervalos do mesmo dia não podem se sobrepor.' }} />)
  const segunda = screen.getByRole('group', { name: 'Segunda-feira' })
  expect(within(segunda).getByText('O fim deve ser depois do início.')).toBeInTheDocument()
  expect(within(segunda).getByLabelText('Fim da faixa 2')).toHaveAttribute('aria-invalid', 'true')
  expect(within(segunda).getByLabelText('Início da faixa 1')).not.toHaveAttribute('aria-invalid')
  expect(within(screen.getByRole('group', { name: 'Sábado' })).getByText('Os intervalos do mesmo dia não podem se sobrepor.')).toBeInTheDocument()
})

test('weekFromMinutes converte o expediente do domínio para HH:mm', () => {
  const semana = weekFromMinutes({ MONDAY: [{ startMin: 540, endMin: 720 }], SUNDAY: [], TUESDAY: [], WEDNESDAY: [], THURSDAY: [], FRIDAY: [], SATURDAY: [] })
  expect(semana.MONDAY).toEqual([{ start: '09:00', end: '12:00' }])
  expect(semana.SUNDAY).toEqual([])
})
