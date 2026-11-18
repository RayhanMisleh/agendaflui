import { addMinutes, minuteToInstant, minuteToInstants } from '@/server/time'

/** Intervalo de instantes; o fim é exclusivo. */
export type Interval = { start: Date; end: Date }
export type WorkingRange = { startMin: number; endMin: number }

/** Dois intervalos se sobrepõem se compartilham algum instante; encostar não é sobrepor. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} inválido: ${value}. Use um número inteiro de minutos, a partir de 1.`)
  }
}

function assertRanges(ranges: readonly WorkingRange[]): void {
  for (const r of ranges) {
    const ok =
      Number.isInteger(r.startMin) &&
      Number.isInteger(r.endMin) &&
      r.startMin >= 0 &&
      r.endMin <= 1440 &&
      r.startMin < r.endMin
    if (!ok) {
      throw new RangeError(
        `Intervalo de expediente inválido: ${r.startMin}–${r.endMin}. Use minutos inteiros de 0 a 1440, com o início antes do fim.`,
      )
    }
  }
}

function assertDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} inválido: informe uma data e hora válidas.`)
  }
}

function assertIntervals(list: readonly Interval[], name: string): void {
  for (const i of list) {
    assertDate(i.start, `Início de ${name}`)
    assertDate(i.end, `Fim de ${name}`)
  }
}

function nonEmpty(list: readonly Interval[]): Interval[] {
  return list.filter((i) => i.start.getTime() < i.end.getTime())
}

/**
 * Inícios possíveis de um atendimento no dia local, como instantes, em ordem e sem repetição.
 * Cada intervalo de expediente é tratado sozinho: o serviço não atravessa a emenda entre dois.
 * `busy` recebe a folga (`bufferMin`) dos dois lados; `blocked` não.
 */
export function computeSlots(i: {
  date: string
  timeZone: string
  workingRanges: readonly WorkingRange[]
  busy: readonly Interval[]
  blocked: readonly Interval[]
  durationMin: number
  stepMin: number
  bufferMin: number
  notBefore: Date
  notAfter: Date
}): Date[] {
  assertPositiveInt(i.durationMin, 'Duração')
  assertPositiveInt(i.stepMin, 'Passo da grade')
  if (!Number.isInteger(i.bufferMin) || i.bufferMin < 0) {
    throw new RangeError(`Intervalo entre atendimentos inválido: ${i.bufferMin}. Use um número inteiro de minutos, a partir de 0.`)
  }
  assertRanges(i.workingRanges)
  assertDate(i.notBefore, 'Limite inicial (notBefore)')
  assertDate(i.notAfter, 'Limite final (notAfter)')
  assertIntervals(i.busy, 'horário ocupado')
  assertIntervals(i.blocked, 'bloqueio')

  const blocked = nonEmpty(i.blocked)
  const busy = nonEmpty(i.busy).map((b) => ({
    start: addMinutes(b.start, -i.bufferMin),
    end: addMinutes(b.end, i.bufferMin),
  }))
  const notBeforeMs = i.notBefore.getTime()
  const notAfterMs = i.notAfter.getTime()

  const found = new Map<number, Date>()
  for (const range of i.workingRanges) {
    const rangeStart = minuteToInstant(i.date, range.startMin, i.timeZone).getTime()
    const rangeEnd = minuteToInstant(i.date, range.endMin, i.timeZone).getTime()
    const first = Math.ceil(range.startMin / i.stepMin) * i.stepMin
    // A grade é a do relógio local. Cada minuto da grade vira todos os instantes em que o relógio o marca: dois na hora
    // repetida (dia de 25 horas), nenhum na hora que não existe (dia de 23 horas). Quem decide se o serviço cabe é o tempo
    // real, comparado ao início e ao fim reais do expediente.
    for (let m = first; m < range.endMin; m += i.stepMin) {
      for (const start of minuteToInstants(i.date, m, i.timeZone)) {
        const candidate = { start, end: addMinutes(start, i.durationMin) }
        const startMs = start.getTime()
        if (startMs < rangeStart || candidate.end.getTime() > rangeEnd) continue
        if (startMs < notBeforeMs || startMs >= notAfterMs) continue
        if (blocked.some((b) => overlaps(candidate, b))) continue
        if (busy.some((b) => overlaps(candidate, b))) continue
        found.set(startMs, start)
      }
    }
  }
  return [...found.values()].sort((a, b) => a.getTime() - b.getTime())
}

/** O atendimento cabe inteiro dentro de algum intervalo de expediente do dia. */
export function fitsWorkingHours(i: {
  start: Date
  end: Date
  date: string
  timeZone: string
  workingRanges: readonly WorkingRange[]
}): boolean {
  assertRanges(i.workingRanges)
  assertDate(i.start, 'Início do atendimento')
  assertDate(i.end, 'Fim do atendimento')
  if (i.start.getTime() >= i.end.getTime()) {
    throw new RangeError('Atendimento inválido: o início precisa ser antes do fim.')
  }
  return i.workingRanges.some(
    (r) =>
      i.start.getTime() >= minuteToInstant(i.date, r.startMin, i.timeZone).getTime() &&
      i.end.getTime() <= minuteToInstant(i.date, r.endMin, i.timeZone).getTime(),
  )
}
