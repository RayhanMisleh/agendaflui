'use client'
import { useActionState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button, FormErrors } from '@/ui/components'
import type { ButtonProps } from '@/ui/components'
import { ESTADO_VAZIO, type EstadoCliente } from './estado'

/**
 * Formulário de uma ação da área do cliente: liga a ação de servidor (que já leva a loja) e mostra o erro no alto, com
 * `role="alert"`, sem apagar o que a pessoa digitou (`state.values`). `onDone` roda uma vez a cada sucesso (fechar a folha,
 * avisar). Sem JavaScript também funciona: a ação roda no servidor (a loja vai amarrada à ação com `bind`, que o Next entende no envio sem JavaScript). Os campos escondidos (`hidden`) levam os ids da tela, que
 * a ação nunca aceita como autoridade: o cliente vem da sessão.
 */
export function ClienteForm({
  action,
  slug,
  hidden = {},
  submit,
  variant = 'primary',
  size = 'lg',
  onDone,
  className,
  disabled,
  submitIcon,
  secondary,
  children,
}: {
  action(slug: string, prev: EstadoCliente, form: FormData): Promise<EstadoCliente>
  slug: string
  hidden?: Record<string, string>
  submit: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  onDone?: (state: EstadoCliente) => void
  className?: string
  disabled?: boolean
  submitIcon?: ReactNode
  secondary?: ReactNode
  children?: (state: EstadoCliente) => ReactNode
}) {
  const [state, formAction, pending] = useActionState(action.bind(null, slug), ESTADO_VAZIO)
  const feito = useRef<EstadoCliente | null>(null)
  useEffect(() => {
    if (state.ok && feito.current !== state) {
      feito.current = state
      onDone?.(state)
    }
  }, [state, onDone])
  return (
    <form action={formAction} className={className ?? 'af-cl-form'} noValidate>
      {Object.entries(hidden).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      {state.ok ? null : <FormErrors message={state.message} fields={state.fields} />}
      {children?.(state)}
      <div className="af-cl-form__foot">
        <Button type="submit" variant={variant} size={size} loading={pending} disabled={disabled} icon={submitIcon}>
          {submit}
        </Button>
        {secondary}
      </div>
    </form>
  )
}
