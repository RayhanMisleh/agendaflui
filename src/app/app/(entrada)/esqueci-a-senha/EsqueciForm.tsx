'use client'
import { useActionState } from 'react'
import { MailCheck } from 'lucide-react'
import { Button, Field, Input } from '@/ui/components'
import type { EstadoEsqueci } from './actions'

/** Pede o e-mail. Funciona sem JavaScript: a ação de servidor é a ação nativa do formulário. */
export function EsqueciForm({ action }: { action: (anterior: EstadoEsqueci, form: FormData) => Promise<EstadoEsqueci> }) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: null, fields: {}, values: {} })
  return (
    <form action={formAction} className="af-entry__form">
      <Field label="E-mail" error={state.fields.email}>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.values.email ?? ''}
          invalid={Boolean(state.fields.email)}
        />
      </Field>
      {state.ok && state.message ? (
        <p role="status" className="af-entry__notice">
          <MailCheck size={18} aria-hidden="true" />
          <span>{state.message}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        {state.ok ? 'Enviar de novo' : 'Enviar instruções'}
      </Button>
    </form>
  )
}
