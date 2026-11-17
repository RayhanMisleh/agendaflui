import type { ReactNode } from 'react'
import { cx } from './cx'

export type BadgeTone = 'confirmed' | 'pending' | 'done' | 'canceled' | 'no-show' | 'neutral'

/** Selo de situação em pílula: sempre um ponto e o texto, nunca só cor. */
export function StatusBadge({ tone, children, className }: { tone: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('af-badge', `af-badge--${tone}`, className)}>
      <span className="af-badge__dot" aria-hidden="true" />
      {children}
    </span>
  )
}
