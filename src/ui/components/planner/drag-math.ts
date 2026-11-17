/*
 * Contas da grade para remarcar arrastando: puras, sem navegador. Tudo em minutos de relógio da conta, desde a meia-noite;
 * nada aqui sabe de fuso (o servidor converte o dia local mais os minutos).
 */

export type DOMRectLike = { left: number; right: number; top: number; bottom: number }

const DIA = 1440

/** Encaixa os minutos no passo da grade da conta mais próximo, sem sair do dia (0 a 24:00). */
export function snapToStep(minutes: number, step: number): number {
  const inteiro = step > 0 ? Math.round(minutes / step) * step : Math.round(minutes)
  return Math.min(DIA, Math.max(0, inteiro))
}

/**
 * Onde a ficha cairia: `pointer` é a posição do TOPO da ficha na tela (ponteiro menos o ponto em que ela foi agarrada).
 * Acha a coluna sob o ponteiro (a borda direita de uma coluna é a esquerda da próxima: no limite vale a da direita) e
 * traduz a altura em minutos, encaixados na grade. Fora de qualquer coluna não há alvo. Acima do topo vale o começo da
 * janela; abaixo do fim, o fim.
 */
export function dropTarget(
  pointer: { x: number; y: number },
  columns: readonly DOMRectLike[],
  dayStartMin: number,
  pxPerMin: number,
  step: number,
): { professionalIndex: number; startMin: number } | null {
  const professionalIndex = columns.findIndex((c) => pointer.x >= c.left && pointer.x < c.right)
  const column = columns[professionalIndex]
  if (!column || pxPerMin <= 0) return null
  const span = (column.bottom - column.top) / pxPerMin
  const raw = Math.min(span, Math.max(0, (pointer.y - column.top) / pxPerMin))
  return { professionalIndex, startMin: snapToStep(dayStartMin + raw, step) }
}

/** Minutos como `HH:mm` (só formatação de relógio, sem fuso): 885 vira `14:45`. */
export function labelOfMinute(minute: number): string {
  const m = Math.min(DIA, Math.max(0, Math.round(minute)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
