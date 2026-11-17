/*
 * Posição das fichas na página do dia. Funções puras, sem banco e sem relógio: tudo em minutos desde a meia-noite local
 * (relógio de parede da conta). Quem chama traduz instantes em minutos pelo módulo de tempo.
 */

export type MinuteRange = { startMin: number; endMin: number }

/** Caixa de uma ficha: `topMin` conta a partir do começo da janela; `lane` de `lanes` divide a largura com as vizinhas. */
export type SlipBox = { id: string; topMin: number; heightMin: number; lane: number; lanes: number }

/**
 * Distribui as fichas em faixas: dentro de um grupo de fichas que se sobrepõem em cadeia, cada uma ocupa a primeira faixa
 * livre e todas dividem a mesma largura (`lanes`). O que passa dos limites da janela é cortado; o que fica todo fora, ou
 * não tem duração, some.
 */
export function layoutDay(items: { id: string; startMin: number; endMin: number }[], dayStartMin: number, dayEndMin: number): SlipBox[] {
  const clipped = items
    .map((i) => ({ id: i.id, start: Math.max(i.startMin, dayStartMin), end: Math.min(i.endMin, dayEndMin) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))

  const boxes: SlipBox[] = []
  let group: { id: string; start: number; end: number; lane: number }[] = []
  let groupEnd = -Infinity
  let laneEnds: number[] = []

  const close = (): void => {
    const lanes = laneEnds.length
    for (const g of group) {
      boxes.push({ id: g.id, topMin: g.start - dayStartMin, heightMin: g.end - g.start, lane: g.lane, lanes })
    }
    group = []
    laneEnds = []
    groupEnd = -Infinity
  }

  for (const item of clipped) {
    if (item.start >= groupEnd) close()
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.end)
    } else {
      laneEnds[lane] = item.end
    }
    group.push({ ...item, lane })
    groupEnd = Math.max(groupEnd, item.end)
  }
  close()
  return boxes
}

const HOUR = 60
const DEFAULT_WINDOW: MinuteRange = { startMin: 8 * HOUR, endMin: 18 * HOUR }
const MIN_SPAN = 4 * HOUR

/** A janela do dia: abraça tudo o que há para mostrar, em horas cheias, entre 00:00 e 24:00. Sem nada, das 08:00 às 18:00. */
export function dayWindow(ranges: MinuteRange[]): MinuteRange {
  const valid = ranges.filter((r) => r.endMin > r.startMin)
  if (valid.length === 0) return DEFAULT_WINDOW
  let start = Math.floor(Math.min(...valid.map((r) => r.startMin)) / HOUR) * HOUR
  let end = Math.ceil(Math.max(...valid.map((r) => r.endMin)) / HOUR) * HOUR
  start = Math.max(0, start)
  end = Math.min(24 * HOUR, end)
  if (end - start < MIN_SPAN) end = Math.min(24 * HOUR, start + MIN_SPAN)
  if (end - start < MIN_SPAN) start = Math.max(0, end - MIN_SPAN)
  return { startMin: start, endMin: end }
}

/** As vagas: o expediente menos o que está ocupado (a união, sem contar a sobreposição duas vezes); só as que cabem uma grade. */
export function freeGaps(working: MinuteRange[], taken: MinuteRange[], minLengthMin: number): MinuteRange[] {
  const busy = [...taken].filter((t) => t.endMin > t.startMin).sort((a, b) => a.startMin - b.startMin)
  const gaps: MinuteRange[] = []
  for (const w of [...working].sort((a, b) => a.startMin - b.startMin)) {
    let cursor = w.startMin
    for (const t of busy) {
      if (t.endMin <= cursor || t.startMin >= w.endMin) continue
      if (t.startMin > cursor) gaps.push({ startMin: cursor, endMin: Math.min(t.startMin, w.endMin) })
      cursor = Math.max(cursor, t.endMin)
      if (cursor >= w.endMin) break
    }
    if (cursor < w.endMin) gaps.push({ startMin: cursor, endMin: w.endMin })
  }
  return gaps.filter((g) => g.endMin - g.startMin >= minLengthMin)
}

/**
 * Início e fim de uma ficha em minutos de relógio. Quando o relógio volta (fim do horário de verão) o fim cai antes ou
 * junto do início: vale a duração real. Quando ele avança, o fim de parede já inclui a hora que pulou, e a grade segue a parede.
 */
export function minutesOfSpan(span: MinuteRange, durationMin: number): MinuteRange {
  if (span.endMin > span.startMin) return span
  return { startMin: span.startMin, endMin: span.startMin + durationMin }
}
