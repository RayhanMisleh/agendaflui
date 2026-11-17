import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Equal } from 'lucide-react'
import { StatNumber } from './StatNumber'
import { cx } from './cx'
import type { TrendInfo } from './trend'

const ICONS = { up: ArrowUp, down: ArrowDown, same: Equal } as const

/**
 * Número de destaque com o rótulo e, quando há, a tendência. A tendência é frase curta (a seta é só reforço, escondida do
 * leitor de tela), então nunca depende de cor. `children` leva um gráfico pequeno.
 */
export function StatTile({
  label,
  value,
  format = 'int',
  size,
  trend,
  children,
  className,
}: {
  label: string
  value: number
  format?: 'int' | 'brl'
  size?: 'lg' | 'md'
  trend?: TrendInfo
  children?: ReactNode
  className?: string
}) {
  const Icon = trend ? ICONS[trend.direction] : null
  return (
    <div className={cx('af-stat', className)}>
      <StatNumber label={label} value={value} format={format} {...(size ? { size } : {})} />
      {trend && Icon ? (
        <div className="af-stat__trend">
          <p className="af-stat__change" data-direction={trend.direction}>
            <Icon size={16} aria-hidden="true" />
            <span>{trend.text}</span>
          </p>
          {trend.reference ? <p className="af-stat__ref">{trend.reference}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}
