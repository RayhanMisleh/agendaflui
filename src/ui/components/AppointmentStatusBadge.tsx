import { StatusBadge } from './StatusBadge'
import type { BadgeTone } from './StatusBadge'

export type Situacao = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW'

export const SITUACOES: Record<Situacao, { tone: BadgeTone; texto: string }> = {
  PENDING: { tone: 'pending', texto: 'Aguardando confirmação' },
  CONFIRMED: { tone: 'confirmed', texto: 'Confirmado' },
  COMPLETED: { tone: 'done', texto: 'Concluído' },
  CANCELED: { tone: 'canceled', texto: 'Cancelado' },
  NO_SHOW: { tone: 'no-show', texto: 'Faltou' },
}

/** A situação de um atendimento em selo, sempre com texto. */
export function AppointmentStatusBadge({ status }: { status: Situacao }) {
  const s = SITUACOES[status]
  return <StatusBadge tone={s.tone}>{s.texto}</StatusBadge>
}
