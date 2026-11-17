export type Range = { start: string; end: string }
export type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'
export type WeekValue = Partial<Record<Weekday, Range[]>>

/** Segunda a domingo, a ordem em que o expediente é lido no Brasil. */
export const WEEK_ORDER: readonly Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

const label = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** O expediente do domínio (minutos desde a meia-noite) em faixas `HH:mm` para o editor. */
export function weekFromMinutes(week: Record<Weekday, { startMin: number; endMin: number }[]>): Record<Weekday, Range[]> {
  const out = {} as Record<Weekday, Range[]>
  for (const d of WEEK_ORDER) out[d] = week[d].map((r) => ({ start: label(r.startMin), end: label(r.endMin) }))
  return out
}

/** Do que o formulário devolveu (`MONDAY.0.start`...) de volta às faixas, para reabrir o editor com o que foi digitado. */
export function weekFromFields(values: Record<string, string>): WeekValue {
  const out: WeekValue = {}
  for (const d of WEEK_ORDER) {
    const indices = [...new Set(Object.keys(values).flatMap((k) => (k.startsWith(`${d}.`) ? [Number(k.split('.')[1])] : [])))].sort((a, b) => a - b)
    out[d] = indices.map((i) => ({ start: values[`${d}.${i}.start`] ?? '', end: values[`${d}.${i}.end`] ?? '' }))
  }
  return out
}
