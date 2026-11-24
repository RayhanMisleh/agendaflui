'use client'
import { useActionState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button, Checkbox, Field, Input } from '@/ui/components'
import type { FalsoState } from './actions'

/** O formulário da tela de simulação do Google (só em desenvolvimento e teste). */
export function FalsoForm({ action, agenda = false }: { action: (anterior: FalsoState, form: FormData) => Promise<FalsoState>; agenda?: boolean }) {
  const [state, formAction, pending] = useActionState(action, { error: null, fields: {} })
  return (
    <form action={formAction} className="af-entry__form">
      <Field label="E-mail" error={state.fields['email']}>
        <Input name="email" type="email" autoComplete="off" required invalid={Boolean(state.fields['email'])} />
      </Field>
      <Field label="Nome">
        <Input name="name" autoComplete="off" />
      </Field>
      <Field label="Identificador" hint="Deixe em branco para usar falso-<e-mail>.">
        <Input name="sub" autoComplete="off" />
      </Field>
      <Checkbox name="verified" defaultChecked label="E-mail confirmado pelo Google" />
      {agenda ? <Checkbox name="agenda" defaultChecked label="Permitir que o Agenda Flui crie eventos na sua agenda" /> : null}
      {state.error ? (
        <p role="alert" className="af-entry__error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        Continuar
      </Button>
      <Button type="submit" name="cancelar" value="1" variant="secondary" size="lg" formNoValidate disabled={pending}>
        Cancelar
      </Button>
    </form>
  )
}
