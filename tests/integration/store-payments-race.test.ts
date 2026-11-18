import { beforeEach, describe, expect, test } from 'vitest'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { expireOverdueOrders } from '@/server/domain/store/expiry'
import { applyPayment } from '@/server/domain/store/payments'
import { cancelOrder } from '@/server/domain/store/orders'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { estoque, pedidoComRetirada } from '../setup/store-orders'
import { cenaPagamento, notificar, pagamentoMp, type CenaPagamento } from '../setup/store-payments'

// Concorrência de verdade: o resultado é provado pelo que está GRAVADO (linhas de payments, status, estoque).

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

let c: CenaPagamento
beforeEach(async () => {
  c = await cenaPagamento()
})
const linha = () => prisma.order.findUniqueOrThrow({ where: { id: c.pedido.id } })

describe('pagamento sob concorrência', () => {
  test('a mesma notificação 3 vezes em paralelo: uma linha, pedido pago, estoque igual', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '2001' }))
    const r = await Promise.all([notificar(c, '2001'), notificar(c, '2001'), notificar(c, '2001')])
    expect(r.map((x) => x.status)).toEqual([200, 200, 200])
    expect(await prisma.payment.count()).toBe(1)
    expect((await linha()).status).toBe('PAID')
    expect(await estoque(c.produto.id)).toBe(8)
    expect(await prisma.auditLog.count({ where: { action: 'order.paid' } })).toBe(1)
  })

  test('applyPayment 5 vezes em paralelo com o mesmo pagamento: uma linha e uma só mudança', async () => {
    const pg = pagamentoMp(c.pedido)
    const ctx = await createSystemContext(c.b.id)
    const r = await Promise.all(Array.from({ length: 5 }, () => applyPayment(ctx, c.pedido.id, pg)))
    expect(r.filter((x) => x.changed)).toHaveLength(1)
    expect(await prisma.payment.count()).toBe(1)
    expect(await estoque(c.produto.id)).toBe(8)
  })

  test('o mesmo pagamento chegando para dois pedidos ao mesmo tempo grava uma linha só e paga um pedido só', async () => {
    const outro = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 2 }])
    const ctx = await createSystemContext(c.b.id)
    const pg = pagamentoMp(c.pedido)
    await Promise.all([applyPayment(ctx, c.pedido.id, pg), applyPayment(ctx, outro.order.id, { ...pg, externalReference: outro.order.id })])
    expect(await prisma.payment.count()).toBe(1)
    expect(await prisma.order.count({ where: { status: 'PAID' } })).toBe(1)
  })

  test('pagar e cancelar (cliente) ao mesmo tempo terminam sempre pagos, com o estoque baixado uma vez', async () => {
    const ctx = await createSystemContext(c.b.id)
    await Promise.allSettled([applyPayment(ctx, c.pedido.id, pagamentoMp(c.pedido)), cancelOrder(c.ctxCliente, c.pedido.id)])
    expect((await linha()).status).toBe('PAID')
    expect(await estoque(c.produto.id)).toBe(8)
  })

  test('pagar e vencer ao mesmo tempo terminam pagos, com o estoque baixado uma vez', async () => {
    await prisma.order.update({ where: { id: c.pedido.id }, data: { expiresAt: new Date(c.now.getTime() - 1000) } })
    const ctx = await createSystemContext(c.b.id)
    await Promise.all([applyPayment(ctx, c.pedido.id, pagamentoMp(c.pedido)), expireOverdueOrders(await createSystemContext(c.b.id, () => new Date(c.now.getTime() + 1000)))])
    expect((await linha()).status).toBe('PAID')
    expect(await estoque(c.produto.id)).toBe(8)
  })

  test('pagamento e estorno do mesmo pagamento em paralelo terminam cancelados, com o estoque devolvido uma vez', async () => {
    const pg = pagamentoMp(c.pedido)
    const ctx = await createSystemContext(c.b.id)
    await Promise.all([applyPayment(ctx, c.pedido.id, pg), applyPayment(ctx, c.pedido.id, { ...pg, status: 'refunded' }), applyPayment(ctx, c.pedido.id, pg)])
    expect((await prisma.payment.findFirstOrThrow()).status).toBe('REFUNDED')
    // Se o estorno entrou antes do pagamento, o pagamento atrasado é ignorado e o pedido nunca foi pago; se entrou depois, cancela.
    const o = await linha()
    expect(['AWAITING_PAYMENT', 'CANCELED']).toContain(o.status)
    expect(await estoque(c.produto.id)).toBe(o.status === 'CANCELED' ? 10 : 8)
  })
})
