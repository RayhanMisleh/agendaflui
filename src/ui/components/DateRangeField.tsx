import { Field } from './Field'
import { Input } from './Input'

/** Intervalo livre de datas: dois campos de data nativos (`de` e `ate`), que funcionam sem JavaScript. */
export function DateRangeField({
  from,
  to,
  error,
  fromName = 'de',
  toName = 'ate',
}: {
  from: string
  to: string
  error?: string
  fromName?: string
  toName?: string
}) {
  return (
    <>
      <Field label="De">
        <Input type="date" name={fromName} defaultValue={from} required />
      </Field>
      <Field label="Até" error={error}>
        <Input type="date" name={toName} defaultValue={to} required />
      </Field>
    </>
  )
}
