import type { TenantContext } from '@/server/auth/actor'
import { DomainError, authorize } from '@/server/domain/errors'
import { setAccessActive } from '@/server/domain/team/access'
import { archiveProfessional, getProfessional } from '@/server/domain/team/professionals'

/**
 * Remove um profissional: arquiva a ficha e desativa o acesso (login) que estava ligado a ela. O arquivamento vem
 * primeiro e é recusado se houver agendamentos futuros (nesse caso nada muda, nem o acesso). Se o acesso não puder ser
 * desativado (por exemplo, é o último dono ativo), a ficha já está arquivada e o erro diz isso.
 */
export async function removeProfessional(ctx: TenantContext, id: string): Promise<void> {
  authorize(ctx, 'manage_team')
  const { membershipId } = await getProfessional(ctx, id)
  await archiveProfessional(ctx, id)
  if (!membershipId) return
  try {
    await setAccessActive(ctx, membershipId, false)
  } catch (err) {
    if (err instanceof DomainError) {
      throw new DomainError(err.code, `A ficha foi arquivada, mas o acesso continua ativo: ${err.message}`, { ...(err.reason ? { reason: err.reason } : {}) })
    }
    throw err
  }
}
