'use client'
import { useActionState } from 'react'
import Link from 'next/link'
import { CircleAlert } from 'lucide-react'
import type { LoginState } from '@/app/_lib/login-form'
import { Button, Field, Input } from '@/ui/components'
import { PasswordInput } from './PasswordInput'

/** Formulário de entrada. Funciona sem JavaScript: a action de servidor é a action nativa do formulário. */
export function LoginForm({
  action,
  forgotHref,
  hidden,
  submitLabel = 'Entrar',
}: {
  action: (prev: LoginState, form: FormData) => Promise<LoginState>
  forgotHref?: string
  /** Campos que a ação precisa e a pessoa não digita (por exemplo, a loja). */
  hidden?: Record<string, string>
  submitLabel?: string
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, email: '' })
  return (
    <form action={formAction} className="af-entry__form">
      {hidden ? Object.entries(hidden).map(([nome, valor]) => <input key={nome} type="hidden" name={nome} value={valor} />) : null}
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
        <PasswordInput name="password" autoComplete="current-password" required invalid={state.error !== null} />
      </Field>
      {forgotHref ? (
        <p className="af-entry__foot">
          <Link href={forgotHref}>Esqueci a senha</Link>
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="af-entry__error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  )
}
