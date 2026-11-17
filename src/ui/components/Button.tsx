import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'

export type ButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
}

/**
 * Botão em pílula (36, 44 e 52 px de altura). `accent` é para a ÚNICA ação festiva de uma tela, uso raro. Carregando,
 * o texto fica no lugar (a largura não muda) e um anel gira por cima.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('af-button', `af-button--${variant}`, `af-button--${size}`, className)}
    >
      {loading ? <span className="af-button__spinner" aria-hidden="true" /> : null}
      <span className="af-button__label">
        {icon ? (
          <span className="af-button__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children}
      </span>
      {loading ? <span className="af-sr">Aguarde…</span> : null}
    </button>
  )
}
