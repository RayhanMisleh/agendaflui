import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export type PaperProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'aside' | 'li' | 'header' | 'footer' | 'main'
  lined?: boolean
  raised?: 0 | 1 | 2
}

/** Folha de papel: onde se lê. `raised` 2 vira ficha, com folhas empilhadas por baixo. */
export function Paper({ as: Tag = 'div', lined, raised = 1, className, ...rest }: PaperProps) {
  return (
    <Tag
      {...rest}
      className={cx('af-paper', `af-paper--r${raised}`, lined && 'af-paper--lined', className)}
    />
  )
}
