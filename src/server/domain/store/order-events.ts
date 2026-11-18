import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { issueCodesForOrder, redeemedByItem, voidCodesForOrder } from '@/server/domain/vouchers/codes'

/*
 * Ponto único dos efeitos de FECHAR um pedido (cancelar, vencer, devolver o pagamento). Cancelamento, vencimento e (na
 * Tarefa 7) estorno chamam estas funções dentro da transação que já trava o pedido; nenhum deles mexe no estoque por conta própria.
 */

/**
 * Efeitos de um pedido que acabou de ser PAGO: chame dentro da transação que o marcou como pago, sob `$lockKey('order', id)`.
 * Registra a auditoria e gera os códigos de voucher (uma vez por unidade, pela chave única `(item, seq)`). Pedido só de
 * vouchers (sem entrega) já nasce entregue: os códigos são a entrega.
 */
export async function orderPaid(tx: TenantTx, ctx: TenantContext, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { number: true, totalCents: true, attention: true, deliveryMethod: true } })
  if (order === null) return
  const codes = await issueCodesForOrder(tx, ctx, orderId)
  if (order.deliveryMethod === 'NONE') await tx.order.updateMany({ where: { id: orderId, status: 'PAID', fulfillmentStatus: 'PENDING' }, data: { fulfillmentStatus: 'DELIVERED' } })
  await audit(ctx, { action: 'order.paid', targetType: 'Order', targetId: orderId, metadata: { number: order.number, totalCents: order.totalCents, attention: order.attention, codes } }, tx)
}

export type VoidReason = 'canceled' | 'expired' | 'refunded'

const VOID_REASON_TEXT: Record<VoidReason, string> = { canceled: 'Pedido cancelado', expired: 'Pedido vencido', refunded: 'Pagamento devolvido no Mercado Pago' }

/**
 * Devolve ao estoque o que o pedido reservou, UMA vez só: o pedido que ainda não devolveu (`stock_released_at` nulo) grava a
 * devolução e só então soma as unidades; já gravado, não faz nada. Pedido que foi pago e cuja entrega já saiu de `PENDING`
 * (separado, enviado ou entregue) não devolve os produtos: não estão mais na prateleira (pedido sem entrega, só de vouchers,
 * não tem prateleira: devolve). As unidades de voucher não usadas voltam
 * em qualquer etapa da entrega. Os códigos de voucher ATIVOS são anulados (o usado fica; se houver algum e o motivo for
 * estorno, o pedido pede atenção `payment_reversed`), e do estoque do voucher só voltam as unidades não usadas. Chame sob
 * `$lockKey('order', id)`. Os itens sobem em ordem de id (produtos, depois vouchers), a ordem das reservas, para dois pedidos
 * nunca esperarem um ao outro.
 */
export async function orderVoided(tx: TenantTx, ctx: TenantContext, orderId: string, how: VoidReason): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if (order === null) return
  // Anular o código é idempotente (só os ATIVOS mudam) e vale mesmo que o estoque já tenha voltado.
  await voidCodesForOrder(tx, ctx, orderId, VOID_REASON_TEXT[how])
  const used = await redeemedByItem(tx, orderId)
  if (how === 'refunded' && used.size > 0) await tx.order.updateMany({ where: { id: orderId }, data: { attention: 'payment_reversed' } })
  if (order.stockReleasedAt !== null) return
  // Entrega já adiantada: o produto não está mais na prateleira, mas as unidades de voucher não usadas voltam sempre.
  const shelfGone = order.paidAt !== null && order.fulfillmentStatus !== 'PENDING' && order.deliveryMethod !== 'NONE'
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const products = shelfGone ? [] : order.items.flatMap((i) => (i.productId === null ? [] : [{ id: i.productId, quantity: i.quantity }])).sort(byId)
  const vouchers = order.items.flatMap((i) => (i.voucherId === null ? [] : [{ id: i.voucherId, quantity: i.quantity - (used.get(i.id) ?? 0) }])).filter((v) => v.quantity > 0).sort(byId)
  if (shelfGone && vouchers.length === 0) return
  const { count } = await tx.order.updateMany({ where: { id: orderId, stockReleasedAt: null }, data: { stockReleasedAt: ctx.clock() } })
  if (count !== 1) return
  for (const i of products) await tx.product.updateMany({ where: { id: i.id }, data: { stock: { increment: i.quantity } } })
  for (const v of vouchers) await tx.voucher.updateMany({ where: { id: v.id }, data: { stock: { increment: v.quantity } } })
  await audit(ctx, { action: 'order.stock_released', targetType: 'Order', targetId: orderId, metadata: { how, items: products.length + vouchers.length } }, tx)
}
