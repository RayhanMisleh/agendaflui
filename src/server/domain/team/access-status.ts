import type { TeamMember } from '@/server/domain/platform/access-core'

/** A situação do acesso de uma pessoa da equipe, do ponto de vista de quem gerencia. */
export type AccessStatus = 'invited' | 'invite_failed' | 'active' | 'inactive' | 'none'

export const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  invited: 'Convite enviado',
  invite_failed: 'Convite não enviado',
  active: 'Ativo',
  inactive: 'Desativado',
  none: 'Sem acesso',
}

/**
 * Desativado vence tudo; com senha definida o acesso está ativo (mesmo que um e-mail antigo tenha falhado); sem senha, o
 * convite saiu ou não saiu. `null` é a ficha sem acesso nenhum.
 */
export function accessStatus(m: Pick<TeamMember, 'active' | 'hasPassword' | 'inviteMailFailed'> | null): AccessStatus {
  if (m === null) return 'none'
  if (!m.active) return 'inactive'
  if (m.hasPassword) return 'active'
  return m.inviteMailFailed ? 'invite_failed' : 'invited'
}
