'use client'
import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { Button, FormErrors } from '@/ui/components'
import { ROTULOS } from './forms'
import type { EstadoConta } from './forms'

/**
 * Moldura dos formulários da conta: liga a ação de servidor, leva a conta (e a versão, quando há) em campos escondidos
 * vindos do estado e mostra o resumo de erros e a confirmação. Os campos são não controlados e voltam a valer o que a
 * pessoa digitou (`state.values`), então um erro ou um conflito de versão nunca apaga o texto.
 */
export function ContaForm({
  action,
  initial,
  submit,
  children,
  className,
  labels,
}: {
  action(prev: EstadoConta, form: FormData): Promise<EstadoConta>
  initial: EstadoConta
  submit: string
  children: (state: EstadoConta) => ReactNode
  className?: string
  labels?: Record<string, string>
}) {
  const [state, formAction, pending] = useActionState(action, initial)
  return (
    <form action={formAction} className={className ?? 'af-acctform'} noValidate>
      <input type="hidden" name="businessId" value={state.values.businessId ?? ''} />
      {state.values.version !== undefined ? <input type="hidden" name="version" value={state.values.version} /> : null}
      {state.ok ? null : <FormErrors message={state.message} fields={state.fields} labels={{ ...ROTULOS, ...labels }} />}
      {children(state)}
      <div className="af-acctform__foot">
        <Button type="submit" variant="primary" loading={pending}>
          {submit}
        </Button>
        {state.ok && state.message ? (
          <p role="status" className="af-acctform__ok">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}
