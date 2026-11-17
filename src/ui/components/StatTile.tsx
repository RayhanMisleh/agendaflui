import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Equal } from 'lucide-react'
import { Counter } from './Counter'
import { cx } from './cx'
import type { TrendInfo } from './trend'

const ICONS = { up: ArrowUp, down: ArrowDown, same: Equal } as const

/**
 * Número de destaque da mesa de controle: contador mecânico com o rótulo e, quando há, a tendência. A tendência é frase
 * (a seta é só reforço, escondida do leitor de tela), então nunca depende de cor. `children` leva um gráfico pequeno.
 */
export function StatTile({
  label,
  value,
  format = 'int',
  digits,
  trend,
  children,
  className,
}: {
  label: string
  value: number
  format?: 'int' | 'brl'
  digits?: number
  trend?: TrendInfo
  children?: ReactNode
  className?: string
}) {
  const Icon = trend ? ICONS[trend.direction] : null
  return (
    <div className={cx('af-stat', className)}>
      <Counter label={label} value={value} format={format} {...(digits !== undefined ? { digits } : {})} />
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
