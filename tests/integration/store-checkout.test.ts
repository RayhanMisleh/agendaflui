import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { cancelOrder } from '@/server/domain/store/orders'
import { startCheckout } from '@/server/domain/store/checkout'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { cenaLoja, configurarIntegracoes, produto } from '../setup/store'
import { cotar, enderecoDe, pedidoComRetirada, prepararEntrega } from '../setup/store-orders'
import { cenaPagamento, MP_TOKEN, type CenaPagamento } from '../setup/store-payments'

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

describe('startCheckout', () => {
  test('sem Mercado Pago configurado: conflito payment_unavailable com a mensagem da loja', async () => {
    const c = await cenaLoja()
    setIntegrationsForTests({ mercadoPago: fakeMercadoPago() })
    const p = await produto(c.dono, { stock: 5 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const e = await domainError(startCheckout(c.ctxCliente, order.id))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('payment_unavailable')
    expect(e.message).toBe('O pagamento pela loja não está disponível agora. Fale com o estabelecimento.')
  })

  describe('com o Mercado Pago falso', () => {
    let c: CenaPagamento
    beforeEach(async () => {
      c = await cenaPagamento()
    })

    test('itens e frete somam o total, a referência é o pedido e a segunda chamada reaproveita a preferência', async () => {
      await prepararEntrega(c)
      const addr = await enderecoDe(c.ctxCliente)
      const lines = [{ productId: c.produto.id, quantity: 2 }]
      const { createOrder } = await import('@/server/domain/store/orders')
      const { order } = await createOrder(c.ctxCliente, { lines, delivery: { method: 'SHIPPING', addressId: addr, quoteToken: await cotar(c.ctxCliente, addr, lines) }, note: null })
      const r = await startCheckout(c.ctxCliente, order.id)
      expect(r.checkoutUrl).toMatch(/^https:\/\//)
      expect(r.expiresAt).toEqual(order.expiresAt)
      expect(r.expiresLabel).toBe(order.expiresLabel)
      const pref = c.fake.preferences[0]!
      expect(pref.orderId).toBe(order.id)
      expect(pref.items.map((i) => i.title)).toEqual(['Shampoo', 'Frete'])
      expect(pref.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)).toBe(order.totalCents)
      expect(order.totalCents).toBe(2 * 2500 + 2150)
      expect(pref.notificationUrl).toMatch(new RegExp(`^http://api\\.localhost:3000/v1/webhooks/mercadopago/${c.webhookKey}$`))
      expect(pref.expiresAt).toEqual(order.expiresAt)
      expect(pref.backUrl).toBeNull()
      expect(c.fake.calls.at(0)?.accessToken).toBe(MP_TOKEN)
      const gravado = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
      expect(gravado.checkoutUrl).toBe(r.checkoutUrl)
      expect(gravado.mpPreferenceId).not.toBeNull()
      const de_novo = await startCheckout(c.ctxCliente, order.id)
      expect(de_novo.checkoutUrl).toBe(r.checkoutUrl)
      expect(c.fake.preferences).toHaveLength(1)
    })

    test('pedido só de produtos: sem linha de frete; e-mail do cliente vai como pagador', async () => {
      await startCheckout(c.ctxCliente, c.pedido.id)
      const pref = c.fake.preferences[0]!
      expect(pref.items).toHaveLength(1)
      expect(pref.items[0]).toMatchObject({ quantity: 2, unitPriceCents: 2500 })
      const email = (await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).email
      expect(pref.payerEmail).toBe(email)
    })

    test('duas chamadas ao mesmo tempo devolvem o mesmo endereço de pagamento', async () => {
      const r = await Promise.all([startCheckout(c.ctxCliente, c.pedido.id), startCheckout(c.ctxCliente, c.pedido.id), startCheckout(c.ctxCliente, c.pedido.id)])
      expect(new Set(r.map((x) => x.checkoutUrl)).size).toBe(1)
      expect((await prisma.order.findUniqueOrThrow({ where: { id: c.pedido.id } })).checkoutUrl).toBe(r[0]!.checkoutUrl)
    })

    test('returnUrl: só vale com origem liberada na chave; fora dela ou sem lista é validation', async () => {
      const origens = ['https://app.exemplo.test']
      const e1 = await domainError(startCheckout(c.ctxCliente, c.pedido.id, { returnUrl: 'https://evil.test/pedido', allowedOrigins: origens }))
      expect(e1.code).toBe('validation')
      expect(e1.fields?.returnUrl).toBeDefined()
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id, { returnUrl: 'https://app.exemplo.test/pedido' }))).code).toBe('validation')
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id, { returnUrl: 'nao-e-url', allowedOrigins: origens }))).code).toBe('validation')
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id, { returnUrl: 'javascript:alert(1)', allowedOrigins: origens }))).code).toBe('validation')
      expect(c.fake.preferences).toHaveLength(0)
      await startCheckout(c.ctxCliente, c.pedido.id, { returnUrl: 'https://app.exemplo.test/pedido', allowedOrigins: origens })
      expect(c.fake.preferences[0]!.backUrl).toBe('https://app.exemplo.test/pedido')
    })

    test('pedido vencido, pago, cancelado: invalid_transition, sem chamar o Mercado Pago', async () => {
      await prisma.order.update({ where: { id: c.pedido.id }, data: { expiresAt: new Date(c.now.getTime() - 1000) } })
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id))).reason).toBe('invalid_transition')
      await prisma.order.update({ where: { id: c.pedido.id }, data: { expiresAt: new Date(c.now.getTime() + 60_000), status: 'PAID', paidAt: c.now } })
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id))).reason).toBe('invalid_transition')
      await prisma.order.update({ where: { id: c.pedido.id }, data: { status: 'AWAITING_PAYMENT', paidAt: null } })
      await cancelOrder(c.ctxCliente, c.pedido.id)
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id))).reason).toBe('invalid_transition')
      expect(c.fake.calls).toHaveLength(0)
    })

    test('pedido de outro cliente: not_found; equipe e visitante: forbidden; Loja desligada: module_disabled', async () => {
      expect((await domainError(startCheckout(c.ctxOutro, c.pedido.id))).code).toBe('not_found')
      expect((await domainError(startCheckout(c.ctxCliente, 'nao-uuid'))).code).toBe('not_found')
      expect((await domainError(startCheckout(c.dono, c.pedido.id))).code).toBe('forbidden')
      await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id))).code).toBe('module_disabled')
      expect(c.fake.calls).toHaveLength(0)
    })

    test('pedido de outra conta: not_found', async () => {
      const outra = await cenaLoja()
      expect((await domainError(startCheckout(outra.ctxCliente, c.pedido.id))).code).toBe('not_found')
    })

    test('Mercado Pago fora do ar: payment_unavailable, pedido igual e nenhum segredo na mensagem', async () => {
      c.fake.failWith('unavailable')
      const e = await domainError(startCheckout(c.ctxCliente, c.pedido.id))
      expect(e.reason).toBe('payment_unavailable')
      expect(e.message).not.toContain(MP_TOKEN)
      const linha = await prisma.order.findUniqueOrThrow({ where: { id: c.pedido.id } })
      expect(linha.mpPreferenceId).toBeNull()
      expect(linha.checkoutUrl).toBeNull()
      expect(linha.status).toBe('AWAITING_PAYMENT')
      c.fake.failWith(null)
      await startCheckout(c.ctxCliente, c.pedido.id)
      expect(c.fake.preferences).toHaveLength(1)
    })

    test('itens que não somam o total: recusa antes de falar com o Mercado Pago', async () => {
      await prisma.orderItem.updateMany({ where: { orderId: c.pedido.id }, data: { quantity: 3, totalCents: 7500 } })
      const e = await domainError(startCheckout(c.ctxCliente, c.pedido.id))
      expect(e.reason).toBe('payment_unavailable')
      expect(c.fake.calls).toHaveLength(0)
    })

    test('segredo do Mercado Pago de outra conta copiado para esta não abre: payment_unavailable', async () => {
      const outra = await cenaLoja()
      await configurarIntegracoes(outra.b.id, { mercadoPago: true })
      const doutra = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: outra.b.id } })
      await prisma.businessIntegration.update({ where: { businessId: c.b.id }, data: { mpAccessTokenEnc: doutra.mpAccessTokenEnc } })
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      expect((await domainError(startCheckout(c.ctxCliente, c.pedido.id))).reason).toBe('payment_unavailable')
      expect(c.fake.calls).toHaveLength(0)
    })
  })
})
