import { Field } from './Field'
import { Input } from './Input'

/** Campo do código de 6 dígitos enviado por e-mail: teclado numérico, preenchimento automático e letras bem espaçadas. */
export function CodeField({ name, error, autoFocus, label = 'Código de 6 dígitos' }: { name: string; error?: string | null; autoFocus?: boolean; label?: string }) {
  return (
    <Field label={label} error={error ?? undefined}>
      <Input
        name={name}
        className="af-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="000000"
        autoFocus={autoFocus}
        required
        invalid={Boolean(error)}
      />
    </Field>
  )
}
