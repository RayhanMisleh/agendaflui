import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { expireOverdueOrders } from '@/server/domain/store/expiry'
import { syncOrderPayments } from '@/server/domain/store/payments'
import { addMinutes } from '@/server/time'

/** Depois de quanto tempo do vencimento o pedido vence mesmo sem conseguirmos conferir o pagamento com o Mercado Pago. */
const GRACE_MIN = 24 * 60
/** Quantos pedidos de uma conta a rodada confere no Mercado Pago; os demais ficam para a rodada seguinte. */
const SYNC_PER_ROUND = 100
const CANDIDATES_MAX = 1000

/**
 * Varredura da loja, uma vez por minuto (agendador, tipo `store`). Para cada conta com pedido vencido aguardando pagamento: os
 * pedidos que abriram o pagamento (têm preferência) são conferidos no Mercado Pago pela referência, e o aviso perdido vira
 * pedido pago; os demais vencem, devolvendo o estoque. Se o Mercado Pago não responde, o pedido espera a próxima rodada, até
 * 24 h depois do vencimento, e então vence. Funciona com a Loja desligada e a conta suspensa (age como sistema). Um erro numa
 * conta é registrado (só o nome) e as outras seguem. Devolve quantos pedidos foram conferidos e quantos venceram.
 */
export async function sweepStore(now: Date): Promise<{ synced: number; expired: number }> {
  const businesses = await prisma.order.findMany({ where: { status: 'AWAITING_PAYMENT', expiresAt: { lte: now } }, distinct: ['businessId'], select: { businessId: true } })
  let synced = 0
  let expired = 0
  const graceStart = addMinutes(now, -GRACE_MIN)
  for (const { businessId } of businesses) {
    try {
      const ctx = await createSystemContext(businessId, () => now)
      const candidates = await ctx.db.order.findMany({
        where: { status: 'AWAITING_PAYMENT', expiresAt: { lte: now, gt: graceStart }, mpPreferenceId: { not: null } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
        take: CANDIDATES_MAX,
      })
      const ids = candidates.map((o) => o.id)
      // O que não foi conferido nesta rodada não vence nela.
      const hold = new Set(ids)
      for (const id of ids.slice(0, SYNC_PER_ROUND)) {
        if (!(await syncOrderPayments(ctx, id))) break
        hold.delete(id)
        synced++
      }
      expired += await expireOverdueOrders(ctx, { except: hold })
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'store_sweep_failed', error: err instanceof Error ? err.name : 'unknown' }))
    }
  }
  return { synced, expired }
}
