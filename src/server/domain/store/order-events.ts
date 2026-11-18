import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'

/*
 * Ponto único dos efeitos de FECHAR um pedido (cancelar, vencer, devolver o pagamento). Cancelamento, vencimento e (na
 * Tarefa 7) estorno chamam estas funções dentro da transação que já trava o pedido; nenhum deles mexe no estoque por conta própria.
 */

export type VoidReason = 'canceled' | 'expired' | 'refunded'

/**
 * Devolve ao estoque o que o pedido reservou, UMA vez só: o pedido que ainda não devolveu (`stock_released_at` nulo) grava a
 * devolução e só então soma as unidades; já gravado, não faz nada. Pedido que foi pago e cuja entrega já saiu de `PENDING`
 * (separado, enviado ou entregue) não devolve: o produto não está mais na prateleira. Chame sob `$lockKey('order', id)`.
 * Os produtos sobem em ordem de id, a mesma ordem das reservas, para dois pedidos nunca esperarem um ao outro.
 */
export async function orderVoided(tx: TenantTx, ctx: TenantContext, orderId: string, how: VoidReason): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if (order === null || order.stockReleasedAt !== null) return
  if (order.paidAt !== null && order.fulfillmentStatus !== 'PENDING') return
  const { count } = await tx.order.updateMany({ where: { id: orderId, stockReleasedAt: null }, data: { stockReleasedAt: ctx.clock() } })
  if (count !== 1) return
  const items = order.items
    .flatMap((i) => (i.productId === null ? [] : [{ productId: i.productId, quantity: i.quantity }]))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
  for (const i of items) await tx.product.updateMany({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } })
  await audit(ctx, { action: 'order.stock_released', targetType: 'Order', targetId: orderId, metadata: { how, items: items.length } }, tx)
}
