import { Temporal } from 'temporal-polyfill'

/**
 * Único lugar do sistema com conversão de fuso horário.
 * O banco guarda instantes; datas locais trafegam como 'YYYY-MM-DD' e horas locais como 'HH:mm'.
 * Nada aqui usa os métodos locais de Date: o fuso do processo nunca entra na conta.
 */

export type Weekday =
  | 'SUNDAY'
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'

// Temporal.dayOfWeek: 1 = segunda ... 7 = domingo.
const WEEKDAYS: readonly Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function isValidTimeZone(tz: string): boolean {
  // Deslocamento fixo ("+03:00") não tem regra de horário de verão; conta precisa de fuso IANA.
  if (typeof tz !== 'string' || tz === '' || /^[+-]/.test(tz)) return false
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(tz)
    return true
  } catch {
    return false
  }
}

function assertTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) throw new RangeError(`Fuso horário inválido: "${tz}"`)
}

function parseDate(date: string): Temporal.PlainDate {
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    throw new RangeError(`Data inválida: "${date}". Use o formato AAAA-MM-DD.`)
  }
  try {
    return Temporal.PlainDate.from(date, { overflow: 'reject' })
  } catch {
    throw new RangeError(`Data inválida: "${date}". Essa data não existe.`)
  }
}

function parseTime(time: string): Temporal.PlainTime {
  const m = typeof time === 'string' ? TIME_RE.exec(time) : null
  if (!m) throw new RangeError(`Hora inválida: "${time}". Use o formato HH:mm, de 00:00 a 23:59.`)
  return new Temporal.PlainTime(Number(m[1]), Number(m[2]))
}

function toZoned(instant: Date, tz: string): Temporal.ZonedDateTime {
  assertTimeZone(tz)
  const ms = instant.getTime()
  if (!Number.isFinite(ms)) throw new RangeError('Instante inválido.')
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz)
}

function fromZoned(z: Temporal.ZonedDateTime): Date {
  return new Date(z.epochMilliseconds)
}

export function isLocalDate(s: string): boolean {
  try {
    parseDate(s)
    return true
  } catch {
    return false
  }
}

export function isLocalTime(s: string): boolean {
  return typeof s === 'string' && TIME_RE.test(s)
}

/** Início (inclusivo) e fim (exclusivo) do dia de calendário no fuso informado. */
export function localDayRange(date: string, tz: string): { start: Date; end: Date } {
  assertTimeZone(tz)
  const day = parseDate(date)
  const start = day.toZonedDateTime(tz)
  const end = day.add({ days: 1 }).toZonedDateTime(tz)
  return { start: fromZoned(start), end: fromZoned(end) }
}

/**
 * Data + hora locais em instante. Hora inexistente (salto do horário de verão) avança;
 * hora repetida usa a primeira ocorrência (regra `compatible`).
 */
export function toInstant(date: string, time: string, tz: string): Date {
  assertTimeZone(tz)
  const local = parseDate(date).toPlainDateTime(parseTime(time))
  return fromZoned(local.toZonedDateTime(tz, { disambiguation: 'compatible' }))
}

export function localParts(
  instant: Date,
  tz: string,
): { date: string; time: string; weekday: Weekday } {
  const z = toZoned(instant, tz)
  return {
    date: z.toPlainDate().toString(),
    time: `${pad2(z.hour)}:${pad2(z.minute)}`,
    weekday: WEEKDAYS[z.dayOfWeek - 1] as Weekday,
  }
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[parseDate(date).dayOfWeek - 1] as Weekday
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return localParts(now, tz).date
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`Quantidade de dias inválida: ${days}`)
  return parseDate(date).add({ days }).toString()
}

export function minutesBetween(a: Date, b: Date): number {
  const diff = b.getTime() - a.getTime()
  if (!Number.isFinite(diff)) throw new RangeError('Instante inválido.')
  return diff / 60_000
}

export function addMinutes(instant: Date, minutes: number): Date {
  const ms = instant.getTime() + minutes * 60_000
  if (!Number.isFinite(ms)) throw new RangeError('Instante ou minutos inválidos.')
  return new Date(ms)
}

export function formatDate(instant: Date, tz: string): string {
  const z = toZoned(instant, tz)
  return `${pad2(z.day)}/${pad2(z.month)}/${String(z.year).padStart(4, '0')}`
}

export function formatTime(instant: Date, tz: string): string {
  const z = toZoned(instant, tz)
  return `${pad2(z.hour)}:${pad2(z.minute)}`
}

export function formatDateTime(instant: Date, tz: string): string {
  return `${formatDate(instant, tz)} ${formatTime(instant, tz)}`
}
