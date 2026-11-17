import type { TenantContext } from '@/server/auth/actor'
import { authorize } from '@/server/domain/errors'
import { removerProfissional } from '@/server/domain/platform/access-core'

/**
 * Remove um profissional: arquiva a ficha e desativa o acesso (login) que estava ligado a ela, tudo numa transação só.
 * As regras de acesso são conferidas antes de gravar qualquer coisa: se a desativação for recusada (o dono removendo a
 * própria ficha, o gerente removendo a ficha de um dono, o último dono ativo) ou houver agendamentos futuros, nada muda.
 */
export async function removeProfessional(ctx: TenantContext, id: string): Promise<void> {
  authorize(ctx, 'manage_team')
  await removerProfissional({ kind: 'conta', ctx }, ctx.businessId, id, ctx.clock())
}
