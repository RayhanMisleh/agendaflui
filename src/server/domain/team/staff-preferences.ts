import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { DomainError } from '@/server/domain/errors'

/**
 * Liga ou desliga, no PRÓPRIO vínculo, o recebimento (por e-mail) dos avisos de todos os agendamentos da loja feitos pelos
 * clientes. Só quem vê todas as agendas (dono e gerente) pode; o profissional recebe `forbidden`. O papel e a situação do
 * vínculo entram no `where`, então um rebaixamento ou desativação no meio do caminho também não grava.
 */
export async function setNotifyAllAppointments(ctx: TenantContext, value: boolean): Promise<void> {
  const actor = ctx.actor
  if (actor.kind !== 'member' || !can(actor, 'view_all_agendas')) {
    throw new DomainError('forbidden', 'Só o dono e o gerente podem receber os avisos de toda a loja.')
  }
  const { count } = await ctx.db.membership.updateMany({
    where: { id: actor.membershipId, active: true, role: { in: ['OWNER', 'MANAGER'] } },
    data: { notifyAllAppointments: value },
  })
  if (count === 0) throw new DomainError('forbidden', 'Só o dono e o gerente podem receber os avisos de toda a loja.')
}
