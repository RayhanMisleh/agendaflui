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
  children,
}: {
  href: string
  variant?: Exclude<ButtonVariant, 'danger'>
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Link href={href} className={cx('af-button', `af-button--${variant}`, `af-button--${size}`, className)}>
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
