// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Celebration, ChoiceCard, DayStrip, EmptyIllustration, ProgressBar, SpeciesIllustration, StepStage, TimeGrid, groupTimes } from '@/ui/components'

describe('ChoiceCard', () => {
  test('é radio nativo, marca ao escolher e devolve valor e estado', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChoiceCard type="radio" name="porte" value="M" checked={false} onChange={onChange} title="Médio" detail="10 a 25 kg" />)
    const radio = screen.getByRole('radio', { name: /Médio/ })
    expect(radio).toHaveAttribute('type', 'radio')
    expect(radio).not.toBeChecked()
    fireEvent.click(radio)
    expect(onChange).toHaveBeenCalledWith('M', true)
    rerender(<ChoiceCard type="radio" name="porte" value="M" checked onChange={onChange} title="Médio" detail="10 a 25 kg" />)
    expect(screen.getByRole('radio')).toBeChecked()
    expect(screen.getByText('Médio').closest('label')).toHaveClass('is-checked')
  })

  test('desabilitado mostra o motivo, ligado ao campo', () => {
    render(<ChoiceCard type="checkbox" name="s" value="x" checked={false} onChange={() => undefined} title="Tosa" disabled disabledReason="Só para o clube" />)
    const caixa = screen.getByRole('checkbox')
    expect(caixa).toBeDisabled()
    expect(screen.getByText('Só para o clube')).toBeInTheDocument()
    expect(caixa).toHaveAccessibleDescription('Só para o clube')
    expect(caixa).not.toBeChecked()
  })
})

const DIAS = [
  { date: '2026-11-25', label: '25', weekdayShort: 'Hoje', available: true },
  { date: '2026-11-26', label: '26', weekdayShort: 'Qui', available: false },
  { date: '2026-11-27', label: '27', weekdayShort: 'Sex', available: true },
  { date: '2026-11-28', label: '28', weekdayShort: 'Sáb', available: true },
]

function DiasComEstado({ onMore }: { onMore?: () => void }) {
  const [v, setV] = useState<string | null>('2026-11-25')
  return <DayStrip days={DIAS} value={v} onChange={setV} {...(onMore ? { onMore } : {})} />
}

describe('DayStrip', () => {
  test('dia sem horário não é escolhível e diz "sem horário" no nome', () => {
    const onChange = vi.fn()
    render(<DayStrip days={DIAS} value={null} onChange={onChange} />)
    const sem = screen.getByRole('radio', { name: 'Qui 26, sem horário' })
    expect(sem).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(sem)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Sex 27' }))
    expect(onChange).toHaveBeenCalledWith('2026-11-27')
  })

  test('as setas movem a escolha para o próximo dia livre e voltam', () => {
    render(<DiasComEstado />)
    const grupo = screen.getByRole('radiogroup', { name: 'Dia' })
    expect(screen.getByRole('radio', { name: 'Hoje 25' })).toBeChecked()
    fireEvent.keyDown(grupo, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Sex 27' })).toBeChecked()
    fireEvent.keyDown(grupo, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Sáb 28' })).toBeChecked()
    fireEvent.keyDown(grupo, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Sáb 28' })).toBeChecked()
    fireEvent.keyDown(grupo, { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Sex 27' })).toBeChecked()
  })

  test('"Mais dias" aparece quando há onMore', () => {
    const onMore = vi.fn()
    render(<DiasComEstado onMore={onMore} />)
    fireEvent.click(screen.getByRole('button', { name: /Mais dias/ }))
    expect(onMore).toHaveBeenCalled()
  })
})

describe('TimeGrid', () => {
  const horarios = [
    { iso: '2026-11-25T12:00:00.000Z', label: '09:00' },
    { iso: '2026-11-25T17:30:00.000Z', label: '14:30' },
    { iso: '2026-11-25T21:00:00.000Z', label: '18:00' },
  ]

  test('agrupa 09:00 em Manhã, 14:30 em Tarde e 18:00 em Noite', () => {
    expect(groupTimes(horarios).map((g) => [g.label, g.times.map((t) => t.label)])).toEqual([
      ['Manhã', ['09:00']],
      ['Tarde', ['14:30']],
      ['Noite', ['18:00']],
    ])
    expect(groupTimes([{ iso: 'x', label: '14:30 (2ª vez)' }])[0]?.label).toBe('Tarde')
  })

  test('escolher devolve o instante exato e marca o chip', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TimeGrid groups={groupTimes(horarios)} value={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '14:30' }))
    expect(onChange).toHaveBeenCalledWith('2026-11-25T17:30:00.000Z')
    rerender(<TimeGrid groups={groupTimes(horarios)} value="2026-11-25T17:30:00.000Z" onChange={onChange} />)
    expect(screen.getByRole('button', { name: '14:30' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'false')
  })
})

test('ProgressBar anuncia "3 de 8"', () => {
  render(<ProgressBar value={3} max={8} label="Andamento do cadastro" />)
  const barra = screen.getByRole('progressbar', { name: 'Andamento do cadastro' })
  expect(barra).toHaveAttribute('aria-valuenow', '3')
  expect(barra).toHaveAttribute('aria-valuemax', '8')
  expect(barra).toHaveAttribute('aria-valuetext', '3 de 8')
  expect(screen.getByText('3 de 8')).toBeInTheDocument()
})

test('StepStage põe o foco no título da etapa nova, e não na primeira', () => {
  const Etapa = ({ k }: { k: string }) => (
    <StepStage stepKey={k} direction={1}>
      <h2 tabIndex={-1}>Pergunta {k}</h2>
      <button type="button">Seguir</button>
    </StepStage>
  )
  const { rerender } = render(<Etapa k="1" />)
  expect(document.activeElement).toBe(document.body)
  rerender(<Etapa k="2" />)
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Pergunta 2' }))
})

test('Celebration e as ilustrações são aria-hidden', () => {
  const { container } = render(
    <>
      <Celebration play />
      <SpeciesIllustration species="DOG" />
      <SpeciesIllustration species="CAT" />
      {(['horarios', 'pets', 'premios', 'carrinho', 'pedidos', 'loja-fechada'] as const).map((n) => (
        <EmptyIllustration key={n} name={n} />
      ))}
    </>,
  )
  expect(container.querySelector('.af-cl-celebration')).toHaveAttribute('aria-hidden', 'true')
  const svgs = container.querySelectorAll('svg')
  expect(svgs).toHaveLength(9)
  svgs.forEach((s) => expect(s).toHaveAttribute('aria-hidden', 'true'))
  expect(container.querySelectorAll('.af-cl-celebration__bubble')).toHaveLength(8)
})
