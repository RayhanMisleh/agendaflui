import type { ReactNode } from 'react'
import { cx } from './cx'

/** Página em branco com a ponta dobrada e um convite à ação. */
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
      <div className="af-empty__sheet">
        <p className="af-empty__title">{title}</p>
        {description ? <p className="af-empty__text">{description}</p> : null}
        {action ? <div className="af-empty__action">{action}</div> : null}
      </div>
    </div>
  )
}
