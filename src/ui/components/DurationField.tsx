import { formatDuration } from '@/ui/format'
import { Select } from './Select'
import type { SelectProps } from './Select'

/** As durações que a grade da conta permite: múltiplos de `stepMin`, de `stepMin` até `maxMin`. Mantém a atual, mesmo fora da grade. */
export function durationOptions(stepMin: number, maxMin: number, current?: number): number[] {
  const out: number[] = []
  for (let m = stepMin; m <= maxMin; m += stepMin) out.push(m)
  if (current !== undefined && current > 0 && !out.includes(current)) out.push(current)
  return out.sort((a, b) => a - b)
}

/** Lista de durações em múltiplos da grade de horários da conta (um passo por vez; a duração atual fora da grade segue na lista). */
export function DurationField({ stepMin, maxMin = 600, value, ...rest }: Omit<SelectProps, 'value' | 'defaultValue' | 'children'> & { stepMin: number; maxMin?: number; value?: number }) {
  return (
    <Select {...rest} defaultValue={value !== undefined ? String(value) : String(stepMin * Math.max(1, Math.round(30 / stepMin)))}>
      {durationOptions(stepMin, maxMin, value).map((m) => (
        <option key={m} value={m}>
          {formatDuration(m)}
          {value === m && m % stepMin !== 0 ? ' (fora da grade)' : ''}
        </option>
      ))}
    </Select>
  )
}
