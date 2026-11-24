// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerDay } from '@/ui/components'
import type { PlannerColumn } from '@/ui/components'

const COLUNAS: PlannerColumn[] = [
  {
    id: 'ana',
    name: 'Ana',
    slips: [
      { id: 's1', professionalId: 'ana', status: 'CONFIRMED', customerName: 'Rex', petName: null, squeezeIn: false, services: 'Banho', startLabel: '14:00', endLabel: '15:00', box: { id: 's1', topMin: 360, heightMin: 60, lane: 0, lanes: 1 }, attention: false, draggable: false },
      { id: 's2', professionalId: 'ana', status: 'PENDING', customerName: 'Mel', petName: null, squeezeIn: false, services: 'Tosa + Banho', startLabel: '15:30', endLabel: '16:30', box: { id: 's2', topMin: 450, heightMin: 60, lane: 0, lanes: 1 }, attention: true, draggable: false },
    ],
    blocks: [{ id: 'b1', startLabel: '12:00', endLabel: '13:00', topMin: 240, heightMin: 60, label: 'Almoço' }],
    gaps: [{ startMin: 540, endMin: 600, startLabel: '09:00', endLabel: '10:00' }],
    inactive: false,
  },
  {
    id: 'caio',
    name: 'Caio',
    slips: [{ id: 's3', professionalId: 'caio', status: 'COMPLETED', customerName: 'Bidu', petName: null, squeezeIn: false, services: 'Tosa', startLabel: '14:30', endLabel: '15:00', box: { id: 's3', topMin: 390, heightMin: 30, lane: 0, lanes: 1 }, attention: false, draggable: false }],
    blocks: [],
    gaps: [],
    inactive: false,
  },
]

const HORAS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => ({ min: h * 60, label: `${String(h).padStart(2, '0')}:00` }))

function montar(extra: Partial<React.ComponentProps<typeof PlannerDay>> = {}) {
  const onOpenSlip = vi.fn()
  const onBookGap = vi.fn()
  render(<PlannerDay columns={COLUNAS} startMin={480} endMin={1080} hours={HORAS} nowMin={null} onOpenSlip={onOpenSlip} onBookGap={onBookGap} label="Agenda de terça-feira" {...extra} />)
  return { onOpenSlip, onBookGap }
}

test('cada ficha é um botão com nome acessível: hora, cliente, serviços e situação', () => {
  montar()
  expect(screen.getByRole('button', { name: '14:00, Rex, Banho, Confirmado' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '15:30, Mel, Tosa + Banho, Aguardando confirmação' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '14:30, Bidu, Tosa, Concluído' })).toBeInTheDocument()
})

test('tocar na ficha abre a ficha; tocar na vaga livre marca nela', async () => {
  const { onOpenSlip, onBookGap } = montar()
  await userEvent.click(screen.getByRole('button', { name: '14:00, Rex, Banho, Confirmado' }))
  expect(onOpenSlip).toHaveBeenCalledWith('s1')
  await userEvent.click(screen.getByRole('button', { name: 'Marcar horário com Ana, livre das 09:00 às 10:00' }))
  expect(onBookGap).toHaveBeenCalledWith('ana', 540)
})

test('o teclado percorre as fichas na ordem da coluna e Enter abre', async () => {
  const { onOpenSlip } = montar()
  const ordem: string[] = []
  await userEvent.tab()
  for (let i = 0; i < 6; i++) {
    const ativo = document.activeElement
    if (ativo instanceof HTMLElement && ativo.dataset.slip) ordem.push(ativo.dataset.slip)
    await userEvent.tab()
  }
  expect(ordem).toEqual(['s1', 's2', 's3'])
  screen.getByRole('button', { name: '14:00, Rex, Banho, Confirmado' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(onOpenSlip).toHaveBeenCalledWith('s1')
})

test('bloqueio aparece hachurado, com o rótulo e o horário em texto', () => {
  montar()
  const bloqueio = screen.getByText('Almoço').closest('.af-planner__block')
  expect(bloqueio).not.toBeNull()
  expect(within(bloqueio as HTMLElement).getByText('12:00 às 13:00')).toBeInTheDocument()
})

test('a ficha que pede atenção ganha a marca de atenção; as horas ficam na margem', () => {
  montar()
  expect(screen.getByRole('button', { name: /Mel/ })).toHaveClass('af-slip--attention')
  expect(screen.getByRole('button', { name: /Rex/ })).not.toHaveClass('af-slip--attention')
  expect(screen.getAllByText('14:00').length).toBeGreaterThan(0)
})

test('linha do agora só aparece quando há minuto de agora', () => {
  const { unmount } = render(<PlannerDay columns={COLUNAS} startMin={480} endMin={1080} hours={HORAS} nowMin={600} onOpenSlip={() => {}} onBookGap={() => {}} label="a" />)
  expect(document.querySelector('.af-planner__now')).not.toBeNull()
  unmount()
  montar()
  expect(document.querySelector('.af-planner__now')).toBeNull()
})

test('no celular só uma coluna por vez, com abas para trocar de profissional', async () => {
  montar()
  const abas = screen.getByRole('tablist', { name: 'Profissionais' })
  const ana = within(abas).getByRole('tab', { name: 'Ana' })
  const caio = within(abas).getByRole('tab', { name: 'Caio' })
  expect(ana).toHaveAttribute('aria-selected', 'true')
  expect(document.querySelector('[data-col="caio"]')).toHaveAttribute('data-active', 'false')
  await userEvent.click(caio)
  expect(caio).toHaveAttribute('aria-selected', 'true')
  expect(document.querySelector('[data-col="caio"]')).toHaveAttribute('data-active', 'true')
  expect(document.querySelector('[data-col="ana"]')).toHaveAttribute('data-active', 'false')
})
