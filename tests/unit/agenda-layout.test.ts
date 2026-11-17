import { dayWindow, freeGaps, layoutDay, minutesOfSpan } from '@/server/domain/scheduling/agenda-layout'

const caixa = (boxes: ReturnType<typeof layoutDay>, id: string) => {
  const b = boxes.find((x) => x.id === id)
  if (!b) throw new Error(`sem caixa ${id}`)
  return b
}

describe('layoutDay', () => {
  test('fichas em sequência, sem sobreposição, ocupam a largura toda e têm altura exata', () => {
    const boxes = layoutDay(
      [
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 600, endMin: 630 },
      ],
      480,
      1080,
    )
    expect(boxes).toEqual([
      { id: 'a', topMin: 60, heightMin: 60, lane: 0, lanes: 1 },
      { id: 'b', topMin: 120, heightMin: 30, lane: 0, lanes: 1 },
    ])
  })

  test('sobreposição em cadeia: faixas sem colisão e o grupo todo divide a mesma largura', () => {
    const boxes = layoutDay(
      [
        { id: 'a', startMin: 540, endMin: 630 },
        { id: 'b', startMin: 600, endMin: 690 },
        { id: 'c', startMin: 660, endMin: 720 },
        { id: 'd', startMin: 800, endMin: 830 },
      ],
      480,
      1080,
    )
    expect(caixa(boxes, 'a')).toMatchObject({ lane: 0, lanes: 2, topMin: 60, heightMin: 90 })
    expect(caixa(boxes, 'b')).toMatchObject({ lane: 1, lanes: 2, topMin: 120, heightMin: 90 })
    // c só encosta em b: volta para a faixa livre de a.
    expect(caixa(boxes, 'c')).toMatchObject({ lane: 0, lanes: 2, topMin: 180, heightMin: 60 })
    // d está sozinho: largura inteira.
    expect(caixa(boxes, 'd')).toMatchObject({ lane: 0, lanes: 1, topMin: 320, heightMin: 30 })
    // Nenhum par na mesma faixa se sobrepõe.
    const dentro = boxes.filter((x) => x.lane === 0)
    for (const x of dentro) for (const y of dentro) {
      if (x.id !== y.id) expect(x.topMin + x.heightMin <= y.topMin || y.topMin + y.heightMin <= x.topMin).toBe(true)
    }
  })

  test('três ao mesmo tempo viram três faixas', () => {
    const boxes = layoutDay(
      [
        { id: 'a', startMin: 600, endMin: 660 },
        { id: 'b', startMin: 600, endMin: 660 },
        { id: 'c', startMin: 600, endMin: 660 },
      ],
      480,
      1080,
    )
    expect(boxes.map((b) => [b.lane, b.lanes])).toEqual([[0, 3], [1, 3], [2, 3]])
  })

  test('ficha que passa do fim do dia é cortada no limite; a que começa antes do início é cortada no começo', () => {
    const boxes = layoutDay(
      [
        { id: 'tarde', startMin: 1050, endMin: 1130 },
        { id: 'cedo', startMin: 450, endMin: 510 },
      ],
      480,
      1080,
    )
    expect(caixa(boxes, 'tarde')).toMatchObject({ topMin: 570, heightMin: 30 })
    expect(caixa(boxes, 'cedo')).toMatchObject({ topMin: 0, heightMin: 30 })
  })

  test('ficha totalmente fora da janela ou sem duração some', () => {
    const boxes = layoutDay(
      [
        { id: 'fora', startMin: 1100, endMin: 1160 },
        { id: 'antes', startMin: 300, endMin: 400 },
        { id: 'zero', startMin: 600, endMin: 600 },
        { id: 'ok', startMin: 600, endMin: 615 },
      ],
      480,
      1080,
    )
    expect(boxes.map((b) => b.id)).toEqual(['ok'])
  })

  test('a ordem de entrada não muda o resultado', () => {
    const a = { id: 'a', startMin: 540, endMin: 600 }
    const b = { id: 'b', startMin: 570, endMin: 630 }
    expect(layoutDay([b, a], 480, 1080)).toEqual(layoutDay([a, b], 480, 1080))
  })
})

describe('dayWindow', () => {
  test('sem nada para mostrar, 08:00 às 18:00', () => {
    expect(dayWindow([])).toEqual({ startMin: 480, endMin: 1080 })
  })

  test('abraça o expediente e os agendamentos, em horas cheias', () => {
    expect(dayWindow([{ startMin: 545, endMin: 1010 }, { startMin: 500, endMin: 560 }])).toEqual({ startMin: 480, endMin: 1020 })
  })

  test('atendimento fora do expediente alarga a janela; nunca passa de 00:00 a 24:00', () => {
    expect(dayWindow([{ startMin: 540, endMin: 1080 }, { startMin: 1380, endMin: 1440 }])).toEqual({ startMin: 540, endMin: 1440 })
    expect(dayWindow([{ startMin: 0, endMin: 30 }])).toEqual({ startMin: 0, endMin: 240 })
  })
})

describe('freeGaps', () => {
  test('tira do expediente o que está ocupado e guarda só as vagas que cabem na grade', () => {
    const vagas = freeGaps(
      [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1080 }],
      [{ startMin: 600, endMin: 660 }, { startMin: 700, endMin: 790 }],
      15,
    )
    expect(vagas).toEqual([
      { startMin: 540, endMin: 600 },
      { startMin: 660, endMin: 700 },
      { startMin: 790, endMin: 1080 },
    ])
  })

  test('vaga menor que a grade não aparece; ocupações sobrepostas contam uma vez', () => {
    expect(freeGaps([{ startMin: 540, endMin: 600 }], [{ startMin: 545, endMin: 600 }], 15)).toEqual([])
    expect(freeGaps([{ startMin: 540, endMin: 600 }], [{ startMin: 540, endMin: 570 }, { startMin: 550, endMin: 580 }], 15)).toEqual([{ startMin: 580, endMin: 600 }])
  })

  test('sem ocupação, a vaga é o expediente inteiro', () => {
    expect(freeGaps([{ startMin: 540, endMin: 600 }], [], 15)).toEqual([{ startMin: 540, endMin: 600 }])
  })
})

describe('minutesOfSpan', () => {
  test('usa os minutos de relógio do início ao fim', () => {
    expect(minutesOfSpan({ startMin: 90, endMin: 210 }, 60)).toEqual({ startMin: 90, endMin: 210 })
  })

  test('quando o relógio volta (fim do horário de verão), vale a duração real', () => {
    expect(minutesOfSpan({ startMin: 90, endMin: 90 }, 60)).toEqual({ startMin: 90, endMin: 150 })
    expect(minutesOfSpan({ startMin: 100, endMin: 80 }, 45)).toEqual({ startMin: 100, endMin: 145 })
  })
})
