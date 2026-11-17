import { dropTarget, labelOfMinute, snapToStep } from '@/ui/components/planner/drag-math'

describe('snapToStep', () => {
  test('arredonda para o passo mais próximo da grade da conta', () => {
    expect(snapToStep(617, 15)).toBe(615)
    expect(snapToStep(623, 15)).toBe(630)
    expect(snapToStep(622, 15)).toBe(615)
    expect(snapToStep(600, 15)).toBe(600)
    expect(snapToStep(612, 5)).toBe(610)
    expect(snapToStep(615, 30)).toBe(630)
  })

  test('nunca sai do dia', () => {
    expect(snapToStep(-20, 15)).toBe(0)
    expect(snapToStep(1439, 15)).toBe(1440)
    expect(snapToStep(2000, 15)).toBe(1440)
  })

  test('passo inválido não quebra: devolve o minuto inteiro dentro do dia', () => {
    expect(snapToStep(617, 0)).toBe(617)
    expect(snapToStep(617, -5)).toBe(617)
  })
})

const COLUNAS = [
  { left: 100, right: 300, top: 50, bottom: 50 + 600 * 1.6 },
  { left: 300, right: 500, top: 50, bottom: 50 + 600 * 1.6 },
]

describe('dropTarget', () => {
  test('o topo da coluna é o começo da janela; cada pixel vale um minuto dividido por pxPerMin, encaixado na grade', () => {
    // 480 + (50 + 96 - 50) / 1.6 = 480 + 60 = 540
    expect(dropTarget({ x: 150, y: 146 }, COLUNAS, 480, 1.6, 15)).toEqual({ professionalIndex: 0, startMin: 540 })
    // 480 + 61/1.6 = 518,1 -> 15 em 15 -> 525
    expect(dropTarget({ x: 400, y: 50 + 38 * 1.6 + 1 }, COLUNAS, 480, 1.6, 15)).toEqual({ professionalIndex: 1, startMin: 525 })
  })

  test('fora de qualquer coluna é null', () => {
    expect(dropTarget({ x: 50, y: 100 }, COLUNAS, 480, 1.6, 15)).toBeNull()
    expect(dropTarget({ x: 600, y: 100 }, COLUNAS, 480, 1.6, 15)).toBeNull()
    expect(dropTarget({ x: 150, y: 100 }, [], 480, 1.6, 15)).toBeNull()
  })

  test('no limite entre duas colunas escolhe a do ponteiro (a da direita a partir da borda)', () => {
    expect(dropTarget({ x: 299.9, y: 100 }, COLUNAS, 480, 1.6, 15)?.professionalIndex).toBe(0)
    expect(dropTarget({ x: 300, y: 100 }, COLUNAS, 480, 1.6, 15)?.professionalIndex).toBe(1)
  })

  test('acima do topo vale o começo da janela; abaixo do fim, o fim', () => {
    expect(dropTarget({ x: 150, y: -500 }, COLUNAS, 480, 1.6, 15)?.startMin).toBe(480)
    expect(dropTarget({ x: 150, y: 5000 }, COLUNAS, 480, 1.6, 15)?.startMin).toBe(1080)
  })
})

test('labelOfMinute formata minutos como HH:mm', () => {
  expect(labelOfMinute(0)).toBe('00:00')
  expect(labelOfMinute(885)).toBe('14:45')
  expect(labelOfMinute(1440)).toBe('24:00')
})
