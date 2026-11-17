import type { ReactNode } from 'react'
import { cx } from './cx'

/** Estado vazio: três bolhas, o título, uma frase e a ação principal. Vazio é um convite, não um erro. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('af-empty', className)}>
      <span className="af-empty__art" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <h3 className="af-empty__title">{title}</h3>
      {description ? <p className="af-empty__text">{description}</p> : null}
      {action ? <div className="af-empty__action">{action}</div> : null}
    </div>
  )
}
