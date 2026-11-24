'use client'
import { useActionState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button, FormErrors } from '@/ui/components'
import type { Campos } from '@/app/_lib/campos'
import type { FormState } from '@/app/_lib/form-state'

export type EstadoPainel = FormState<Campos>

export const ESTADO_INICIAL: EstadoPainel = { ok: false, message: null, fields: {}, values: {} }

/**
 * Moldura dos formulários do painel do negócio: liga a ação de servidor, mostra o resumo de erros no alto e a confirmação
 * embaixo. Os campos são não controlados e voltam a valer o que a pessoa digitou (`state.values`), então um erro nunca
 * apaga o texto. `onDone` roda uma vez a cada sucesso (fechar a folha, por exemplo). Sem JavaScript o formulário
 * também funciona: a ação roda no servidor.
 */
export function PainelForm({
  action,
  initial = ESTADO_INICIAL,
  submit,
  children,
  onDone,
  className,
  labels,
  anchors,
  secondary,
}: {
  action(prev: EstadoPainel, form: FormData): Promise<EstadoPainel>
  initial?: EstadoPainel
  submit: string | ((state: EstadoPainel) => string)
  children: (state: EstadoPainel) => ReactNode
  onDone?: (state: EstadoPainel) => void
  className?: string
  labels?: Record<string, string>
  anchors?: Record<string, string>
  secondary?: ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, initial)
  const feito = useRef<EstadoPainel | null>(null)
  useEffect(() => {
    if (state.ok && feito.current !== state) {
      feito.current = state
      onDone?.(state)
    }
  }, [state, onDone])
  return (
    <form action={formAction} className={className ?? 'af-acctform'} noValidate>
      {state.ok ? null : <FormErrors message={state.message} fields={state.fields} labels={labels} anchors={anchors} />}
      {children(state)}
      <div className="af-acctform__foot">
        <Button type="submit" variant="primary" loading={pending}>
          {typeof submit === 'function' ? submit(state) : submit}
        </Button>
        {secondary}
        {state.ok && state.message ? (
          <p role="status" className="af-acctform__ok">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}
