import type { ReactNode } from 'react'
import { cx } from './cx'

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral'

/** Carimbo de situação. A caixa alta vem do CSS: o texto lido continua em frase normal. */
export function Stamp({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('af-stamp', `af-stamp--${tone}`, className)}>
      <span className="af-stamp__ink">{children}</span>
    </span>
  )
}
