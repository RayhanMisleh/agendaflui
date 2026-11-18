import { randomInt } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import { authorize, DomainError, orNotFound, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { applyPayment } from '@/server/domain/store/payments'
import { env } from '@/server/env'
import { integrations } from '@/server/integrations'
import { isFakeMercadoPago } from '@/server/integrations/fakes'

const MSG = 'O pagamento simulado só existe no ambiente de teste.'

/** O ambiente aceita o pagamento simulado? Só com `INTEGRATIONS_MODE=fake` e nunca em produção. */
export function simulationAllowed(): boolean {
  return env.INTEGRATIONS_MODE === 'fake' && env.NODE_ENV !== 'production'
}

/** A tela oferece "Simular pagamento aprovado"? Só com o Mercado Pago falso em uso, fora de produção. */
export function canSimulatePayment(): boolean {
  return simulationAllowed() && isFakeMercadoPago(integrations().mercadoPago)
}

/**
 * "Simular pagamento aprovado" (ambiente de teste): registra no Mercado Pago FALSO um pagamento aprovado com o valor do
 * pedido, consulta-o e o aplica pelo mesmo caminho do webhook (`applyPayment`). Recusa (`forbidden`) fora do modo falso e
 * em produção, e quando o Mercado Pago em uso não é o falso. Só `manage_store`, só pedido aguardando pagamento.
 */
export async function simulateApprovedPayment(ctx: TenantContext, orderId: string): Promise<void> {
  await requireModule(ctx, 'store')
  authorize(ctx, 'manage_store')
  const gateway = integrations().mercadoPago
  if (!simulationAllowed() || !isFakeMercadoPago(gateway)) throw new DomainError('forbidden', MSG)
  if (!z.uuid().safeParse(orderId).success) throw new DomainError('not_found', 'Pedido não encontrado.')
  const order = orNotFound(await ctx.db.order.findUnique({ where: { id: orderId } }), 'Pedido')
  if (order.status !== 'AWAITING_PAYMENT') {
    throw new DomainError('conflict', 'Só dá para simular o pagamento de um pedido que aguarda o pagamento.', { reason: 'invalid_transition' })
  }
  const id = `${ctx.clock().getTime()}${String(randomInt(1000, 10000))}`
  gateway.registerPayment({ id, status: 'approved', statusDetail: 'accredited', amountCents: order.totalCents, currency: 'BRL', externalReference: order.id, approvedAt: ctx.clock() })
  // Passa pela consulta como o webhook: o que vale é o que o "Mercado Pago" devolve.
  const payment = await gateway.getPayment('token-de-teste', id)
  await applyPayment(ctx, order.id, payment)
}
