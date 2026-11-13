import type { ComponentProps, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cx } from './cx'

export type ButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
}

/** Tecla com curso: a parede inferior some e a tecla desce 2 px ao apertar. */
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
      <span className="af-button__face">
        {loading ? (
          <LoaderCircle className="af-button__spinner" size={18} aria-hidden="true" />
        ) : icon ? (
          <span className="af-button__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children}
        {loading ? <span className="af-sr">Aguarde…</span> : null}
      </span>
    </button>
  )
}
