// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerDay } from '@/ui/components'
import type { PlannerColumn } from '@/ui/components'

const slip = (id: string, professionalId: string, topMin: number, extra: Partial<PlannerColumn['slips'][number]> = {}): PlannerColumn['slips'][number] => ({
  id,
  professionalId,
  status: 'CONFIRMED',
  customerName: `Cliente ${id}`,
  petName: null,
  squeezeIn: false,
  services: 'Banho',
  startLabel: '14:00',
  endLabel: '15:00',
  box: { id, topMin, heightMin: 60, lane: 0, lanes: 1 },
  attention: false,
  draggable: true,
  ...extra,
})

const COLUNAS: PlannerColumn[] = [
  { id: 'ana', name: 'Ana', slips: [slip('s1', 'ana', 360), slip('fixa', 'ana', 120, { status: 'COMPLETED', draggable: false, startLabel: '10:00' })], blocks: [], gaps: [], inactive: false },
  { id: 'caio', name: 'Caio', slips: [], blocks: [], gaps: [], inactive: false },
]
const HORAS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => ({ min: h * 60, label: `${String(h).padStart(2, '0')}:00` }))

function montar(extra: Partial<React.ComponentProps<typeof PlannerDay>> = {}) {
  const onMove = vi.fn()
  const onOpenSlip = vi.fn()
  render(<PlannerDay columns={COLUNAS} startMin={480} endMin={1080} hours={HORAS} nowMin={null} step={15} canCross onMove={onMove} onOpenSlip={onOpenSlip} onBookGap={() => {}} label="Agenda" {...extra} />)
  return { onMove, onOpenSlip }
}

const ficha = () => screen.getByRole('button', { name: /Cliente s1/ })

describe('teclado', () => {
  test('três setas para baixo e Enter chamam a ação com três passos da grade a mais', async () => {
    const { onMove, onOpenSlip } = montar()
    ficha().focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('status')).toHaveTextContent('14:45')
    await userEvent.keyboard('{Enter}')
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith('s1', { professionalId: 'ana', startMin: 840 + 45 })
    expect(onOpenSlip).not.toHaveBeenCalled()
  })

  test('seta para cima volta um passo; Esc cancela e não chama a ação', async () => {
    const { onMove } = montar()
    ficha().focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(screen.getByRole('status')).toHaveTextContent('14:15')
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Enter}')
    expect(onMove).not.toHaveBeenCalled()
  })

  test('seta para o lado troca de profissional (quem vê todas as agendas)', async () => {
    const { onMove } = montar()
    ficha().focus()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    expect(onMove).toHaveBeenCalledWith('s1', { professionalId: 'caio', startMin: 840 })
  })

  test('sem poder trocar de coluna, a seta para o lado não faz nada', async () => {
    const { onMove } = montar({ canCross: false })
    ficha().focus()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    expect(onMove).not.toHaveBeenCalled()
  })

  test('não passa dos limites do dia e Enter sem mover abre a ficha', async () => {
    const { onMove, onOpenSlip } = montar()
    ficha().focus()
    await userEvent.keyboard('{ArrowDown}'.repeat(40))
    await userEvent.keyboard('{Enter}')
    // 1080 (fim) - 60 (duração) = 1020
    expect(onMove).toHaveBeenCalledWith('s1', { professionalId: 'ana', startMin: 1020 })
    onMove.mockClear()
    ficha().focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpenSlip).toHaveBeenCalledWith('s1')
  })

  test('ficha que não pode ser arrastada ignora as setas', async () => {
    const { onMove } = montar()
    screen.getByRole('button', { name: /Cliente fixa/ }).focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onMove).not.toHaveBeenCalled()
  })

  test('sem onMove (celular, só a folha) as setas não movem', async () => {
    const { onOpenSlip } = montar({ onMove: undefined })
    ficha().focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onOpenSlip).toHaveBeenCalledWith('s1')
  })
})

describe('ponteiro', () => {
  function medir() {
    for (const [i, corpo] of Array.from(document.querySelectorAll<HTMLElement>('.af-planner__body')).entries()) {
      corpo.getBoundingClientRect = () => ({ left: 100 + i * 200, right: 300 + i * 200, top: 50, bottom: 50 + 600 * 1.6, width: 200, height: 960, x: 100 + i * 200, y: 50, toJSON: () => ({}) })
    }
    ficha().getBoundingClientRect = () => ({ left: 100, right: 300, top: 50 + 360 * 1.6, bottom: 50 + 420 * 1.6, width: 200, height: 96, x: 100, y: 626, toJSON: () => ({}) })
  }

  test('arrastar com o mouse para outra coluna e outro horário mostra a prévia e, ao soltar, chama a ação', () => {
    const { onMove, onOpenSlip } = montar()
    medir()
    const f = ficha()
    fireEvent.pointerDown(f, { pointerType: 'mouse', button: 0, clientX: 150, clientY: 640, pointerId: 1 })
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 350, clientY: 50 + 96 + 14, pointerId: 1 })
    expect(document.querySelector('.af-planner__preview')).not.toBeNull()
    fireEvent.pointerUp(window, { pointerType: 'mouse', clientX: 350, clientY: 50 + 96 + 14, pointerId: 1 })
    // topo da ficha = y - (640 - 626) = 146 -> 60 min depois do começo -> 09:00
    expect(onMove).toHaveBeenCalledWith('s1', { professionalId: 'caio', startMin: 540 })
    expect(document.querySelector('.af-planner__preview')).toBeNull()
    fireEvent.click(f)
    expect(onOpenSlip).not.toHaveBeenCalled()
  })

  test('um toque curto, sem arrastar, só abre a ficha', () => {
    const { onMove, onOpenSlip } = montar()
    medir()
    const f = ficha()
    fireEvent.pointerDown(f, { pointerType: 'mouse', button: 0, clientX: 150, clientY: 640, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerType: 'mouse', clientX: 150, clientY: 641, pointerId: 1 })
    fireEvent.click(f)
    expect(onMove).not.toHaveBeenCalled()
    expect(onOpenSlip).toHaveBeenCalledWith('s1')
  })

  test('no toque (celular) não há arrastar', () => {
    const { onMove } = montar()
    medir()
    fireEvent.pointerDown(ficha(), { pointerType: 'touch', button: 0, clientX: 150, clientY: 640, pointerId: 1 })
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 350, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 350, clientY: 200, pointerId: 1 })
    expect(onMove).not.toHaveBeenCalled()
    expect(document.querySelector('.af-planner__preview')).toBeNull()
  })

  test('soltar fora das colunas ou apertar Esc cancela, e a ficha fica onde estava', () => {
    const { onMove } = montar()
    medir()
    fireEvent.pointerDown(ficha(), { pointerType: 'mouse', button: 0, clientX: 150, clientY: 640, pointerId: 1 })
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 900, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerType: 'mouse', clientX: 900, clientY: 200, pointerId: 1 })
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.pointerDown(ficha(), { pointerType: 'mouse', button: 0, clientX: 150, clientY: 640, pointerId: 2 })
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 350, clientY: 200, pointerId: 2 })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerUp(window, { pointerType: 'mouse', clientX: 350, clientY: 200, pointerId: 2 })
    expect(onMove).not.toHaveBeenCalled()
  })

  test('quem só pode a própria coluna não solta em outra', () => {
    const { onMove } = montar({ canCross: false })
    medir()
    fireEvent.pointerDown(ficha(), { pointerType: 'mouse', button: 0, clientX: 150, clientY: 640, pointerId: 1 })
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 350, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerType: 'mouse', clientX: 350, clientY: 200, pointerId: 1 })
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe('avisos e foco', () => {
  test('Esc, perda de foco e envio são falados na região viva', async () => {
    montar()
    ficha().focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('status')).toHaveTextContent('Mover para 14:15')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('status')).toHaveTextContent('Movimento cancelado.')

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('status')).toHaveTextContent('Mover para 14:15')
    act(() => ficha().blur())
    expect(screen.getByRole('status')).toHaveTextContent('Movimento cancelado.')

    ficha().focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('Enviado para confirmar.')
  })

  test('Esc durante o arrasto com o mouse também é falado', () => {
    montar()
    const f = ficha()
    fireEvent.pointerDown(f, { pointerType: 'mouse', button: 0, clientX: 150, clientY: 640, pointerId: 1 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('status')).toHaveTextContent('Movimento cancelado.')
  })

  test('quando a ficha enviada troca de coluna, o foco vai com ela', async () => {
    const onMove = vi.fn()
    const props = { startMin: 480, endMin: 1080, hours: HORAS, nowMin: null, step: 15, canCross: true, onMove, onOpenSlip: () => {}, onBookGap: () => {}, label: 'Agenda' }
    const { rerender } = render(<PlannerDay columns={COLUNAS} {...props} />)
    ficha().focus()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    expect(onMove).toHaveBeenCalledWith('s1', { professionalId: 'caio', startMin: 840 })
    const movida: PlannerColumn[] = [
      { ...COLUNAS[0]!, slips: COLUNAS[0]!.slips.filter((x) => x.id !== 's1') },
      { ...COLUNAS[1]!, slips: [slip('s1', 'caio', 360)] },
    ]
    rerender(<PlannerDay columns={movida} {...props} />)
    expect(ficha()).toHaveFocus()
  })

  test('quem pegou o foco em outro lugar não o perde para a ficha', async () => {
    const onMove = vi.fn()
    const props = { startMin: 480, endMin: 1080, hours: HORAS, nowMin: null, step: 15, canCross: true, onMove, onOpenSlip: () => {}, onBookGap: () => {}, label: 'Agenda' }
    const { rerender } = render(
      <>
        <button type="button">Outro</button>
        <PlannerDay columns={COLUNAS} {...props} />
      </>,
    )
    ficha().focus()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    screen.getByRole('button', { name: 'Outro' }).focus()
    const movida: PlannerColumn[] = [
      { ...COLUNAS[0]!, slips: COLUNAS[0]!.slips.filter((x) => x.id !== 's1') },
      { ...COLUNAS[1]!, slips: [slip('s1', 'caio', 360)] },
    ]
    rerender(
      <>
        <button type="button">Outro</button>
        <PlannerDay columns={movida} {...props} />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Outro' })).toHaveFocus()
  })
})
