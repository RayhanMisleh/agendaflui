'use client'
import { useActionState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button, Field, Input } from '@/ui/components'
import type { DefinirSenhaState } from './actions'

/** Formulário de definir a senha. Funciona sem JavaScript: a ação de servidor é a ação nativa do formulário. */
export function DefinirSenhaForm({
  token,
  action,
}: {
  token: string
  action: (anterior: DefinirSenhaState, form: FormData) => Promise<DefinirSenhaState>
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, fields: {} })
  return (
    <form action={formAction} className="af-entry__form">
      <input type="hidden" name="token" value={token} />
      <Field label="Senha" hint="Use 10 caracteres ou mais." error={state.fields['password']}>
        <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required invalid={Boolean(state.fields['password'])} />
      </Field>
      <Field label="Repita a senha" error={state.fields['confirm']}>
        <Input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={200} required invalid={Boolean(state.fields['confirm'])} />
      </Field>
      {state.error ? (
        <p role="alert" className="af-entry__error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        Criar senha e entrar
      </Button>
    </form>
  )
}
