import type { HTMLAttributes } from 'react'
import { Bubbles } from './Bubbles'
import { cx } from './cx'

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'aside' | 'li' | 'header' | 'footer' | 'main'
  /** `tint` (Bolha) e `warm` (Mel) sem borda; `block` é o bloco de destaque, na cor da conta. */
  variant?: 'default' | 'tint' | 'warm' | 'block'
  /** Só no `block`: desenha as bolhas da marca nas bordas. */
  bubbles?: boolean
}

/** Cartão: superfície com borda fina, sem sombra. */
export function Card({ as: Tag = 'div', variant = 'default', bubbles, className, children, ...rest }: CardProps) {
  return (
    <Tag {...rest} className={cx('af-card', variant !== 'default' && `af-card--${variant}`, className)}>
      {variant === 'block' && bubbles ? <Bubbles on="brand" /> : null}
      {children}
    </Tag>
  )
}
