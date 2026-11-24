'use client'
import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/ui/components'
import type { ButtonProps } from '@/ui/components'
import { ESTADO_INICIAL } from './PainelForm'
import type { EstadoPainel } from './PainelForm'

/**
 * Um botão que roda uma ação de servidor com campos escondidos (o `id` e o que mais ela pedir), sem folha nem
 * confirmação: subir e descer, restaurar, mandar um e-mail. O erro aparece logo abaixo do botão.
 */
export function AcaoDeLinha({
  action,
  campos,
  children,
  icon,
  variant = 'secondary',
  size = 'sm',
  ariaLabel,
  onDone,
  disabled,
  showOk,
}: {
  action(prev: EstadoPainel, form: FormData): Promise<EstadoPainel>
  campos: Record<string, string>
  children?: ReactNode
  icon?: ReactNode
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  ariaLabel?: string
  onDone?: () => void
  disabled?: boolean
  /** Mostra a confirmação do servidor depois do sucesso (sem ela, só o erro aparece). */
  showOk?: boolean
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: EstadoPainel, fd: FormData) => {
      const r = await action(prev, fd)
      if (r.ok) onDone?.()
      return r
    },
    ESTADO_INICIAL,
  )
  return (
    <form action={formAction}>
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      <Button type="submit" variant={variant} size={size} loading={pending} disabled={disabled} icon={icon} aria-label={ariaLabel}>
        {children}
      </Button>
      {showOk && state.ok && state.message ? (
        <p role="status" className="af-acctform__ok">
          {state.message}
        </p>
      ) : null}
      {state.message && !state.ok ? (
        <p role="alert" className="af-rowerror">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
