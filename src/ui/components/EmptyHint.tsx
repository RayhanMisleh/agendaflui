import type { ReactNode } from 'react'
import { cx } from './cx'

/** Dica de uma linha para uma lista que está vazia dentro de um cartão que tem outras coisas. Para a tela inteira vazia, use `EmptyState`. */
export function EmptyHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('af-hint', className)}>{children}</p>
}
