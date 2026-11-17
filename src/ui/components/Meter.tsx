import { cx } from './cx'

/**
 * Barra de medida em pílula. `value` de 0 a 1; `display` é o texto lido (por exemplo "98%"). Com `alertAt`, passar desse
 * ponto pinta o preenchimento em `accent` e diz isso em texto.
 */
export function Meter({
  value,
  label,
  display,
  alertAt,
  className,
}: {
  value: number
  label: string
  display: string
  alertAt?: number
  className?: string
}) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const alerta = alertAt !== undefined && v >= alertAt
  return (
    <div className={cx('af-meter', alerta && 'af-meter--alert', className)}>
      <span className="af-meter__label">{label}</span>
      <div className="af-meter__row">
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={v}
          aria-valuetext={display}
          className="af-meter__track"
        >
          <span className="af-meter__fill" style={{ width: `${(v * 100).toFixed(1)}%` }} />
        </div>
        <span className="af-meter__value">{display}</span>
      </div>
      {alerta ? <span className="af-meter__alert">Acima do limite de alerta</span> : null}
    </div>
  )
}
