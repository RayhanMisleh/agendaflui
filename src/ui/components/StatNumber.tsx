import { useId } from 'react'
import { cx } from './cx'
import { formatInt } from '../format'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Número em destaque (Bricolage 700, algarismos tabulares) com o rótulo. `lg` tem 44 px e `md` 32 px. */
export function StatNumber({
  value,
  label,
  format = 'int',
  size = 'lg',
  className,
}: {
  value: number
  label: string
  format?: 'int' | 'brl'
  size?: 'lg' | 'md'
  className?: string
}) {
  const labelId = useId()
  const text = format === 'brl' ? BRL.format(value / 100) : formatInt(value)
  return (
    <div role="group" aria-labelledby={labelId} className={cx('af-statnum', `af-statnum--${size}`, className)}>
      <div id={labelId} className="af-statnum__label">
        {label}
      </div>
      <div className="af-statnum__value">{text}</div>
    </div>
  )
}
