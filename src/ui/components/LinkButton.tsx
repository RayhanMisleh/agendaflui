import type { ReactNode } from 'react'
import Link from 'next/link'
import { cx } from './cx'
import type { ButtonVariant } from './Button'

/** O botão como link: mesma aparência do Button, para navegar em vez de agir. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  external,
  children,
}: {
  href: string
  variant?: Exclude<ButtonVariant, 'danger'>
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  className?: string
  /** Abre em outra aba (WhatsApp, e-mail, endereços de fora do painel). */
  external?: boolean
  children: ReactNode
}) {
  return (
    <Link href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={cx('af-button', `af-button--${variant}`, `af-button--${size}`, className)}>
      <span className="af-button__label">
        {icon ? (
          <span className="af-button__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children}
      </span>
    </Link>
  )
}
