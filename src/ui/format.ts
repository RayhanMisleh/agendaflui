const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Inteiro em pt-BR, com ponto de milhar (`1.234.567`). O único formatador de inteiros das telas. */
export function formatInt(n: number): string {
  return INT.format(n)
}

export { formatDuration } from '@/shared/duration'

const WEEKDAY_PT: Record<string, string> = {
  SUNDAY: 'Domingo',
  MONDAY: 'Segunda-feira',
  TUESDAY: 'Terça-feira',
  WEDNESDAY: 'Quarta-feira',
  THURSDAY: 'Quinta-feira',
  FRIDAY: 'Sexta-feira',
  SATURDAY: 'Sábado',
}

/** Nome do dia da semana em português (`TUESDAY` → `Terça-feira`). */
export function weekdayName(weekday: string): string {
  return WEEKDAY_PT[weekday] ?? weekday
}

/** `AAAA-MM-DD` como `DD/MM` (sem o ano), para datas próximas. */
export function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  return month && day ? `${day}/${month}` : isoDate
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Centavos como reais: `3590` → `R$ 35,90`. */
export function formatMoney(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, ' ')
}

/** `AAAA-MM-DD` como `DD/MM/AAAA`. */
export function formatLocalDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return year && month && day ? `${day}/${month}/${year}` : isoDate
}

export { formatLongDate, formatShortDayMonth, relativeDayLabel } from '@/shared/local-date-pt'
