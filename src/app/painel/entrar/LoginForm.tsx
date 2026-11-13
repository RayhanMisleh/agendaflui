'use client'
import { useActionState } from 'react'
import { CircleAlert } from 'lucide-react'
import type { LoginState } from '@/app/_lib/login-form'
import { Button, Field, Input } from '@/ui/components'

/** Formulário de entrada. Funciona sem JavaScript: a action de servidor é a action nativa do formulário. */
export function LoginForm({ action }: { action: (prev: LoginState, form: FormData) => Promise<LoginState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null, email: '' })
  return (
    <form action={formAction} className="af-entry__form">
      <Field label="E-mail">
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.email}
          invalid={state.error !== null}
        />
      </Field>
      <Field label="Senha">
        <Input name="password" type="password" autoComplete="current-password" required invalid={state.error !== null} />
      </Field>
      {state.error ? (
        <p role="alert" className="af-entry__error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        Entrar
      </Button>
    </form>
  )
}
