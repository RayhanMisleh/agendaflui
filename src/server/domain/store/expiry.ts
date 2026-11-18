import type { TenantContext } from '@/server/auth/actor'
import { audit } from '@/server/domain/audit'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { orderVoided } from '@/server/domain/store/order-events'

const BATCH = 100
const MAX_BATCHES = 50

/**
 * Vence os pedidos aguardando pagamento cujo prazo acabou (`expires_at` menor ou igual a agora): cada um sob a trava do próprio
 * pedido, relendo o estado dentro dela, e o estoque que ele reservava volta uma vez só (`orderVoided`). Repetir é inofensivo:
 * pedido já vencido não é tocado nem devolve de novo. Roda com a Loja desligada (o estoque e o dinheiro já pago não esperam o
 * módulo) e com a conta suspensa, por isso não confere módulo nem permissão: quem chama é o sistema. `except` deixa de fora pedidos que a varredura ainda não conseguiu conferir com o Mercado Pago. Devolve quantos venceram.
 */
export async function expireOverdueOrders(ctx: TenantContext, o: { except?: ReadonlySet<string> } = {}): Promise<number> {
  const except = [...(o.except ?? [])]
  const failed = new Set<string>()
  let expired = 0
  for (let round = 0; round < MAX_BATCHES; round++) {
    const now = ctx.clock()
    const due = await ctx.db.order.findMany({
      where: { status: 'AWAITING_PAYMENT', expiresAt: { lte: now }, ...(except.length + failed.size > 0 ? { id: { notIn: [...except, ...failed] } } : {}) },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: BATCH,
    })
    if (due.length === 0) break
    for (const { id } of due) {
      let done = false
      try {
        done = await ctx.db.$transaction(async (tx) => {
          await tx.$lockKey('order', id)
          // Relê sob a trava: o pedido pode ter sido pago ou cancelado entre a lista e a trava.
          const { count } = await tx.order.updateMany({ where: { id, status: 'AWAITING_PAYMENT', expiresAt: { lte: ctx.clock() } }, data: { status: 'EXPIRED' } })
          if (count !== 1) return false
          await orderVoided(tx, ctx, id, 'expired')
          await audit(ctx, { action: 'order.expired', targetType: 'Order', targetId: id }, tx)
          return true
        }, TX_OPTIONS)
      } catch (err) {
        // Um pedido que falha (tempo da trava, banco) não segura os outros: só o nome do erro vai ao log e a próxima rodada tenta de novo.
        failed.add(id)
        console.error(JSON.stringify({ level: 'error', event: 'order_expiry_failed', error: err instanceof Error ? err.name : 'unknown' }))
      }
      if (done) expired++
    }
    if (due.length < BATCH) break
  }
  return expired
}
