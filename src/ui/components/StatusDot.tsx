import { cx } from './cx'

export type StateTone = 'success' | 'warning' | 'danger' | 'neutral'

/** O estado dito em palavras, para acompanhar o ponto. */
export const STATE_TEXT: Record<StateTone, string> = {
  success: 'Funcionando',
  warning: 'Atenção',
  danger: 'Com falha',
  neutral: 'Desligada',
}

export type BusinessStatusKey = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'

const SITUACAO: Record<BusinessStatusKey, { tone: StateTone; label: string }> = {
  ACTIVE: { tone: 'success', label: 'Ativa' },
  SUSPENDED: { tone: 'warning', label: 'Suspensa' },
  ARCHIVED: { tone: 'neutral', label: 'Arquivada' },
}

/** Tom e texto da situação de uma conta, prontos para o `StatusDot`. */
export function businessStatusDot(status: BusinessStatusKey): { tone: StateTone; label: string } {
  return SITUACAO[status]
}

/** Ponto de 10 px com o texto. O estado também aparece em palavras (`detail`): a cor nunca é a única pista. */
export function StatusDot({ tone, label, detail, className }: { tone: StateTone; label: string; detail?: string; className?: string }) {
  return (
    <span className={cx('af-dot', `af-dot--${tone}`, className)}>
      <span className="af-dot__mark" aria-hidden="true" />
      <span className="af-dot__text">
        <span className="af-dot__label">{label}</span>
        {detail ? <span className="af-dot__detail">{detail}</span> : null}
      </span>
    </span>
  )
}
