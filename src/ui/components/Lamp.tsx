import { cx } from './cx'

export type LampState = 'on' | 'warn' | 'error' | 'off'

const STATE_TEXT: Record<LampState, string> = {
  on: 'Funcionando',
  warn: 'Atenção',
  error: 'Com falha',
  off: 'Desligada',
}

/** Lâmpada-piloto. O estado também aparece em texto: a cor nunca é a única pista. */
export function Lamp({ state, label, className }: { state: LampState; label: string; className?: string }) {
  return (
    <span className={cx('af-lamp', `af-lamp--${state}`, className)}>
      <span className="af-lamp__lens" aria-hidden="true" />
      <span className="af-lamp__text">
        <span className="af-lamp__label">{label}</span>
        <span className="af-lamp__state">{STATE_TEXT[state]}</span>
      </span>
    </span>
  )
}
