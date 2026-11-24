'use client'
import { Button } from './Button'
import { Field } from './Field'
import { Input } from './Input'
import { formatDuration } from '@/ui/format'

/**
 * Duração livre da equipe, em minutos inteiros (5 a 720). O texto digitado viaja em `name`; o servidor confere a faixa. A
 * ajuda mostra a soma dos serviços e, quando o valor é outro, "Usar a soma" volta a ela.
 */
export function MinutesField({
  id,
  name,
  value,
  onChange,
  sumMin,
  error,
  label = 'Duração',
}: {
  id: string
  name: string
  value: string
  onChange: (next: string) => void
  sumMin: number
  error?: string | undefined
  label?: string
}) {
  const diferente = value.trim() !== String(sumMin)
  return (
    <div className="af-minutes">
      <Field label={label} hint={`Soma dos serviços: ${formatDuration(sumMin)}.`} error={error}>
        <Input id={id} name={name} type="number" min={5} max={720} step={1} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="af-minutes__row">
        <span className="af-minutes__unit">minutos</span>
        {diferente ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(String(sumMin))}>
            Usar a soma
          </Button>
        ) : null}
      </div>
    </div>
  )
}
