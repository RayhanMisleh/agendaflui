import { cx } from './cx'

/** Barra de progresso do quiz e do agendar: "3 de 8" em texto e a barra que cresce de lado (só `transform`). */
export function ProgressBar({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const total = Math.max(1, max)
  const atual = Math.min(Math.max(0, value), total)
  return (
    <div className={cx('af-cl-progress', className)}>
      <div
        className="af-cl-progress__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={atual}
        aria-valuetext={`${atual} de ${total}`}
      >
        <span className="af-cl-progress__fill" style={{ transform: `scaleX(${atual / total})` }} />
      </div>
      <span className="af-cl-progress__text" aria-hidden="true">
        {atual} de {total}
      </span>
    </div>
  )
}
