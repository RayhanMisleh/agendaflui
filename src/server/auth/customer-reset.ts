import 'server-only'
import { areaLink } from '@/server/area-links'
import { prisma } from '@/server/db/client'
import { auditIn } from '@/server/domain/audit'
import { authorize, DomainError } from '@/server/domain/errors'
import { deliverAccessMail } from '@/server/notifications/deliver-mail'
import { renderPasswordReset } from '@/server/notifications/render-password-reset'
import type { TenantContext } from './actor'
import { isUuid } from './context'
import { allowResetEmail, issuePasswordReset, lockUserAccess, RESET_TTL_MINUTES } from './password-reset'

/**
 * A equipe manda o link de redefinição de senha à pessoa ligada a um cliente com conta. Só quem pode
 * gerenciar clientes; o suporte ("entrar como") não manda redefinição de senha de ninguém. Cliente de balcão (sem conta), arquivado ou removido: `conflict`. Divide o teto de pedidos de
 * redefinição do e-mail com o "esqueci a senha". O link vai ao e-mail da PESSOA, nunca a um endereço digitado.
 */
export async function sendCustomerAccountReset(ctx: TenantContext, customerId: string): Promise<void> {
  authorize(ctx, 'manage_clients')
  if (ctx.actor.kind !== 'member') {
    throw new DomainError('forbidden', 'O suporte não pode mandar redefinição de senha.')
  }
  if (!isUuid(customerId)) throw new DomainError('not_found', 'Cliente não encontrado.')
  const cliente = await ctx.db.customer.findFirst({ where: { id: customerId }, select: { id: true, userId: true, archivedAt: true, anonymizedAt: true } })
  if (!cliente) throw new DomainError('not_found', 'Cliente não encontrado.')
  if (cliente.userId === null || cliente.archivedAt !== null || cliente.anonymizedAt !== null) {
    throw new DomainError('conflict', 'Este cliente ainda não tem conta.')
  }
  const userId = cliente.userId
  const now = ctx.clock()
  const feito = await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, userId)
    // Relê sob a trava: a ligação pode ter sido desfeita (cadastro removido) enquanto esperava.
    const atual = await tx.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId, userId, archivedAt: null, anonymizedAt: null }, select: { id: true } })
    if (!atual) throw new DomainError('conflict', 'Este cliente ainda não tem conta.')
    const pessoa = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } })
    if (!(await allowResetEmail(pessoa.email, now, tx))) {
      throw new DomainError('conflict', 'Já mandamos várias redefinições de senha para esta pessoa. Aguarde alguns minutos e tente de novo.', { reason: 'too_early' })
    }
    const emitido = await issuePasswordReset(tx, userId, now)
    await auditIn(tx, ctx, { action: 'customer.password_reset_sent', targetType: 'Customer', targetId: customerId })
    return { pessoa, emitido }
  })
  await deliverAccessMail(
    'password_reset',
    feito.pessoa.email,
    renderPasswordReset({ name: feito.pessoa.name, link: areaLink('app', `/redefinir-senha/${feito.emitido.token}`), ttlMin: RESET_TTL_MINUTES }),
  )
}
