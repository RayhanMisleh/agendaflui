import { cx } from './cx'
import type { LampState } from './Lamp'

export type BusinessStatusKey = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'

const SITUACAO: Record<BusinessStatusKey, { state: LampState; text: string }> = {
  ACTIVE: { state: 'on', text: 'Ativa' },
  SUSPENDED: { state: 'warn', text: 'Suspensa' },
  ARCHIVED: { state: 'off', text: 'Arquivada' },
}

/** Lâmpada pequena para listas: a situação da conta em texto e em luz (a cor nunca é a única pista). */
export function StatusLamp({ status, className }: { status: BusinessStatusKey; className?: string }) {
  const s = SITUACAO[status]
  return (
    <span className={cx('af-statuslamp', `af-lamp--${s.state}`, className)}>
      <span className="af-lamp__lens" aria-hidden="true" />
      <span className="af-statuslamp__text">{s.text}</span>
    </span>
  )
}
