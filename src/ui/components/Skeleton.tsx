import { cx } from './cx'

const WIDTHS = [100, 92, 97, 76, 64]

/** Blocos que pulsam devagar enquanto o conteúdo chega (parados com `prefers-reduced-motion`). */
export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" className={cx('af-skeleton', className)}>
      <span className="af-sr">Carregando…</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="af-skeleton__line"
          style={{ width: `${i === lines - 1 && lines > 1 ? 58 : (WIDTHS[i % WIDTHS.length] ?? 100)}%` }}
        />
      ))}
    </div>
  )
}
