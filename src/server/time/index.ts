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

/** Dias da semana de domingo a sábado. Temporal.dayOfWeek vai de 1 (segunda) a 7 (domingo): use `dayOfWeek % 7`. */
export const WEEKDAYS: readonly Weekday[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
]

const MS_PER_DAY = 86_400_000
const MINUTE_LABEL_RE = /^(\d{2}):(\d{2})$/

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
    weekday: WEEKDAYS[z.dayOfWeek % 7] as Weekday,
  }
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[parseDate(date).dayOfWeek % 7] as Weekday
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

const MAX_EPOCH_MS = 8.64e15

/** Instante a partir de milissegundos desde 1970 (UTC). Recusa valor não inteiro ou fora do limite de `Date`. */
export function fromEpochMs(ms: number): Date {
  if (!Number.isInteger(ms) || Math.abs(ms) > MAX_EPOCH_MS) throw new RangeError('Milissegundos inválidos.')
  return new Date(ms)
}

/** Texto ISO 8601 em UTC (`2026-11-14T03:30:00.000Z`), para gravar ou trafegar um instante. */
export function toIsoInstant(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Instante inválido.')
  return instant.toISOString()
}

/** Dia de hoje no fuso da conta: data de calendário (`2026-11-13`) e texto para a tela (`13/11/2026`). */
export function todayLine(instant: Date, tz: string): { iso: string; label: string } {
  return { iso: todayIn(tz, instant), label: formatDate(instant, tz) }
}

function assertMinute(minute: number): void {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) {
    throw new RangeError(`Minuto do dia inválido: ${minute}. Use um número inteiro de 0 a 1440.`)
  }
}

/** Minuto desde a meia-noite local (0..1440) em instante. 1440 é 00:00 do dia seguinte. Mesma regra `compatible` de `toInstant`. */
export function minuteToInstant(date: string, minute: number, tz: string): Date {
  assertTimeZone(tz)
  assertMinute(minute)
  const day = parseDate(date)
  const local = day.toPlainDateTime(new Temporal.PlainTime(0, 0)).add({ minutes: minute })
  return fromZoned(local.toZonedDateTime(tz, { disambiguation: 'compatible' }))
}

/** Minuto desde a meia-noite local (0..1439) do instante no fuso da conta. */
export function minuteOfDay(instant: Date, tz: string): number {
  const z = toZoned(instant, tz)
  return z.hour * 60 + z.minute
}

/** 540 vira '09:00'; 1440 vira '24:00'. */
export function minuteLabel(minute: number): string {
  assertMinute(minute)
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`
}

/** 'HH:mm' (de 00:00 a 24:00, dois dígitos em cada parte) em minutos desde a meia-noite. */
export function parseMinuteLabel(label: string): number {
  const m = typeof label === 'string' ? MINUTE_LABEL_RE.exec(label) : null
  const hours = m ? Number(m[1]) : Number.NaN
  const minutes = m ? Number(m[2]) : Number.NaN
  const total = hours * 60 + minutes
  if (!m || minutes > 59 || total > 1440) {
    throw new RangeError(`Hora inválida: "${label}". Use o formato HH:mm, de 00:00 a 24:00.`)
  }
  return total
}

/** `Date` que o Prisma devolve para coluna `date` (meia-noite UTC do dia) em 'AAAA-MM-DD'. */
export function dbDateToLocal(d: Date): string {
  const ms = d.getTime()
  if (!Number.isFinite(ms)) throw new RangeError('Data do banco inválida.')
  if (ms % MS_PER_DAY !== 0) {
    throw new RangeError(
      `Data do banco inválida: ${d.toISOString()}. Uma coluna de data vem à meia-noite UTC; isto parece um instante comum.`,
    )
  }
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO('UTC').toPlainDate().toString()
}

/** 'AAAA-MM-DD' em `Date` à meia-noite UTC, para gravar em coluna `date`. */
export function localToDbDate(date: string): Date {
  return new Date(parseDate(date).toZonedDateTime('UTC').epochMilliseconds)
}

/** Segunda a domingo da semana que contém a data. */
export function isoWeekRange(date: string): { start: string; end: string } {
  const day = parseDate(date)
  const start = day.subtract({ days: day.dayOfWeek - 1 })
  return { start: start.toString(), end: start.add({ days: 6 }).toString() }
}

export function compareLocalDates(a: string, b: string): -1 | 0 | 1 {
  return Temporal.PlainDate.compare(parseDate(a), parseDate(b)) as -1 | 0 | 1
}

/** Dias de `a` até `b` (negativo se `b` vem antes). */
export function daysBetween(a: string, b: string): number {
  return parseDate(b).since(parseDate(a), { largestUnit: 'days' }).days
}
