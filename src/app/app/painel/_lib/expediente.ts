import type { Campos } from '@/app/_lib/campos'
import { DomainError } from '@/server/domain/errors'
import type { DayRanges, WeekSchedule } from '@/server/domain/team/working-hours'
import { WEEKDAYS, isLocalTime, parseMinuteLabel } from '@/server/time'

const CAMPO_DE_FAIXA = /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\.(\d+)\.(start|end)$/

/** Lê todos os campos `DIA.n.start|end` do formulário, sem perder o nome de nenhum (a tela reexibe o que foi digitado). */
export function lerFaixas(fd: FormData, base: Campos = {}): Campos {
  const v: Campos = { ...base }
  for (const [chave, valor] of fd.entries()) if (CAMPO_DE_FAIXA.test(chave) && typeof valor === 'string') v[chave] = valor
  return v
}

/** Do formulário para o expediente do domínio: todos os dias entram (dia sem faixa fica fechado). Erros apontam a faixa. */
export function expedienteDe(v: Campos): WeekSchedule {
  const semana = {} as WeekSchedule
  const erros: Record<string, string> = {}
  for (const dia of WEEKDAYS) {
    const faixas: DayRanges = []
    const indices = [...new Set(Object.keys(v).flatMap((k) => (k.startsWith(`${dia}.`) ? [Number(k.split('.')[1])] : [])))].sort((a, b) => a - b)
    for (const i of indices) {
      const ini = (v[`${dia}.${i}.start`] ?? '').trim()
      const fim = (v[`${dia}.${i}.end`] ?? '').trim()
      if (!isLocalTime(ini)) erros[`${dia}.${i}.start`] = 'Use o horário no formato HH:mm, por exemplo 09:00.'
      if (!isLocalTime(fim)) erros[`${dia}.${i}.end`] = 'Use o horário no formato HH:mm, por exemplo 18:00.'
      if (isLocalTime(ini) && isLocalTime(fim)) faixas.push({ startMin: parseMinuteLabel(ini), endMin: parseMinuteLabel(fim) })
      else faixas.push({ startMin: 0, endMin: 0 })
    }
    semana[dia] = faixas
  }
  if (Object.keys(erros).length > 0) throw new DomainError('validation', 'Confira os horários informados e tente de novo.', { fields: erros })
  return semana
}

/** O domínio chama os lados da faixa de `startMin` e `endMin`; o formulário, de `start` e `end`. */
export function faixaDoFormulario(err: unknown): unknown {
  if (!(err instanceof DomainError) || !err.fields) return err
  const fields = Object.fromEntries(Object.entries(err.fields).map(([k, m]) => [k.replace(/\.startMin$/, '.start').replace(/\.endMin$/, '.end'), m]))
  return new DomainError(err.code, err.message, { fields, ...(err.reason ? { reason: err.reason } : {}) })
}
