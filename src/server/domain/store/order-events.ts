import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'

/*
 * Ponto único dos efeitos de FECHAR um pedido (cancelar, vencer, devolver o pagamento). Cancelamento, vencimento e (na
 * Tarefa 7) estorno chamam estas funções dentro da transação que já trava o pedido; nenhum deles mexe no estoque por conta própria.
 */

/**
 * Efeitos de um pedido que acabou de ser PAGO: chame dentro da transação que o marcou como pago, sob `$lockKey('order', id)`.
 * Registra a auditoria do pagamento.
 */
export async function orderPaid(tx: TenantTx, ctx: TenantContext, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { number: true, totalCents: true, attention: true } })
  if (order === null) return
  await audit(ctx, { action: 'order.paid', targetType: 'Order', targetId: orderId, metadata: { number: order.number, totalCents: order.totalCents, attention: order.attention } }, tx)
}

export type VoidReason = 'canceled' | 'expired' | 'refunded'

/**
 * Devolve ao estoque o que o pedido reservou, UMA vez só: o pedido que ainda não devolveu (`stock_released_at` nulo) grava a
 * devolução e só então soma as unidades; já gravado, não faz nada. Pedido que foi pago e cuja entrega já saiu de `PENDING`
 * (separado, enviado ou entregue) não devolve os produtos: não estão mais na prateleira. Chame sob
 * `$lockKey('order', id)`. Os itens sobem em ordem de id, a ordem das reservas, para dois pedidos nunca esperarem um ao outro.
 */
export async function orderVoided(tx: TenantTx, ctx: TenantContext, orderId: string, how: VoidReason): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if (order === null) return
  if (order.stockReleasedAt !== null) return
  // Entrega já adiantada: o produto não está mais na prateleira.
  const shelfGone = order.paidAt !== null && order.fulfillmentStatus !== 'PENDING'
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const products = shelfGone ? [] : order.items.flatMap((i) => (i.productId === null ? [] : [{ id: i.productId, quantity: i.quantity }])).sort(byId)
  if (products.length === 0) return
  const { count } = await tx.order.updateMany({ where: { id: orderId, stockReleasedAt: null }, data: { stockReleasedAt: ctx.clock() } })
  if (count !== 1) return
  for (const i of products) await tx.product.updateMany({ where: { id: i.id }, data: { stock: { increment: i.quantity } } })
  await audit(ctx, { action: 'order.stock_released', targetType: 'Order', targetId: orderId, metadata: { how, items: products.length } }, tx)
}
