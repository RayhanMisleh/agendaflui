/*
 * Rótulos de datas locais ('AAAA-MM-DD') em português, só com aritmética de calendário: sem `Date`, sem fuso. Servem ao
 * servidor e ao navegador (o fuso já foi resolvido antes de a data virar texto).
 */

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const
const SEMANA_CURTA = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'] as const
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const
const MESES_CURTOS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'] as const

function partes(date: string): { y: number; m: number; d: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) }
}

/** Dias desde 1970-01-01 (calendário gregoriano proléptico). */
export function dayNumber(date: string): number {
  const { y: ano, m, d } = partes(date)
  const y = m <= 2 ? ano - 1 : ano
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** A data local `n` dias depois (ou antes, se negativo). */
export function shiftDate(date: string, n: number): string {
  const z = dayNumber(date) + n + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 0 = domingo. */
export function weekdayIndex(date: string): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7
}

/** "sábado, 29 de novembro". */
export function formatLongDate(date: string): string {
  const { m, d } = partes(date)
  return `${SEMANA[weekdayIndex(date)]}, ${d} de ${MESES[m - 1]}`
}

/** "sáb., 29 de nov.". */
export function formatShortDayMonth(date: string): string {
  const { m, d } = partes(date)
  return `${SEMANA_CURTA[weekdayIndex(date)]}, ${d} de ${MESES_CURTOS[m - 1]}`
}

/** "Hoje", "Amanhã" ou "sáb., 29 de nov.". */
export function relativeDayLabel(date: string, today: string): string {
  const diff = dayNumber(date) - dayNumber(today)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  return formatShortDayMonth(date)
}
