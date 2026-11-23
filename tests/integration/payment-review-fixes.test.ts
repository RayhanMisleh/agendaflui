import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { anonymizeCustomer } from '@/server/domain/customers/customers'
import { sweepStore } from '@/server/domain/platform/store-sweep'
import { startCheckout } from '@/server/domain/store/checkout'
import { cancelOrder } from '@/server/domain/store/orders'
import { applyPayment } from '@/server/domain/store/payments'
import { updateStoreSettings } from '@/server/domain/store/settings'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { cenaLoja, configurarIntegracoes, mpTokenDe, produto } from '../setup/store'
import { estoque, pedidoComRetirada } from '../setup/store-orders'
import { cenaPagamento, notificar, pagamentoMp, type CenaPagamento } from '../setup/store-payments'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

const MIN = 60_000
let c: CenaPagamento
beforeEach(async () => {
  c = await cenaPagamento()
})
const sistema = () => createSystemContext(c.b.id, () => c.now)
const linha = (id = c.pedido.id) => prisma.order.findUniqueOrThrow({ where: { id } })

describe('1. aviso repetido não desfaz o cancelamento do dono num pedido já pago', () => {
  test('pagar, o dono cancelar e o mesmo aviso chegar de novo: continua cancelado, estoque igual, uma auditoria de pagamento', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '9001' }))
    expect(await notificar(c, '9001')).toEqual({ status: 200 })
    expect(await estoque(c.produto.id)).toBe(8)
    await cancelOrder(c.dono, c.pedido.id, { reason: 'Sem estoque real' })
    expect(await estoque(c.produto.id)).toBe(10)
    for (let i = 0; i < 3; i++) expect(await notificar(c, '9001')).toEqual({ status: 200 })
    expect(await linha()).toMatchObject({ status: 'CANCELED', cancelReason: 'Sem estoque real', attention: null })
    expect(await estoque(c.produto.id)).toBe(10)
    expect(await prisma.auditLog.count({ where: { action: 'order.paid' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'order.reopened_by_payment' } })).toBe(0)
  })

  test('pedido que NUNCA foi pago e venceu continua reabrindo quando o pagamento chega depois', async () => {
    await prisma.order.update({ where: { id: c.pedido.id }, data: { status: 'EXPIRED', stockReleasedAt: c.now } })
    await prisma.product.update({ where: { id: c.produto.id }, data: { stock: 10 } })
    await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido))
    expect((await linha()).status).toBe('PAID')
    expect(await estoque(c.produto.id)).toBe(8)
  })
})

describe('2. pagamento a mais pede atenção do dono', () => {
  test('segundo pagamento aprovado num pedido pago: attention double_payment, auditoria, e o pedido segue pago', async () => {
    const ctx = await sistema()
    await applyPayment(ctx, c.pedido.id, pagamentoMp(c.pedido, { id: '9101' }))
    const dois = pagamentoMp(c.pedido, { id: '9102' })
    expect(await applyPayment(ctx, c.pedido.id, dois)).toEqual({ orderStatus: 'PAID', changed: true })
    expect(await linha()).toMatchObject({ status: 'PAID', attention: 'double_payment' })
    expect(await estoque(c.produto.id)).toBe(8)
    expect(await prisma.payment.count()).toBe(2)
    expect(await prisma.auditLog.count({ where: { action: 'order.double_payment' } })).toBe(1)
    // O mesmo aviso de novo não muda nem audita outra vez.
    expect(await applyPayment(ctx, c.pedido.id, dois)).toEqual({ orderStatus: 'PAID', changed: false })
    expect(await prisma.auditLog.count({ where: { action: 'order.double_payment' } })).toBe(1)
  })

  test('não troca uma atenção que já existe; pagamento novo depois do cancelamento de um pedido pago também é marcado', async () => {
    const ctx = await sistema()
    await applyPayment(ctx, c.pedido.id, pagamentoMp(c.pedido, { id: '9101' }))
    await cancelOrder(c.dono, c.pedido.id)
    await applyPayment(ctx, c.pedido.id, pagamentoMp(c.pedido, { id: '9103' }))
    expect(await linha()).toMatchObject({ status: 'CANCELED', attention: 'double_payment' })
    await prisma.order.update({ where: { id: c.pedido.id }, data: { attention: 'payment_reversed' } })
    await applyPayment(ctx, c.pedido.id, pagamentoMp(c.pedido, { id: '9104' }))
    expect((await linha()).attention).toBe('payment_reversed')
  })
})

describe('7. applyPayment confere a referência', () => {
  test('referência de outro pedido ou ausente: nada é gravado nem muda', async () => {
    const outro = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }])
    const ctx = await sistema()
    const errada = pagamentoMp(c.pedido, { id: '9201', externalReference: outro.order.id })
    expect(await applyPayment(ctx, c.pedido.id, errada)).toEqual({ orderStatus: 'AWAITING_PAYMENT', changed: false })
    expect(await applyPayment(ctx, c.pedido.id, pagamentoMp(c.pedido, { id: '9202', externalReference: null }))).toEqual({ orderStatus: 'AWAITING_PAYMENT', changed: false })
    expect(await prisma.payment.count()).toBe(0)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })
})

describe('9. assinatura do aviso: se vier, vale; se não vier, a chave secreta da URL autentica', () => {
  test('válida, inválida e ausente', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '9301' }))
    expect(await notificar(c, '9301', { secret: 'segredo-errado-0123456789abcdef' })).toEqual({ status: 401 })
    expect(c.fake.calls).toHaveLength(0)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect(await notificar(c, '9301', { assinatura: false })).toEqual({ status: 200 })
    expect((await linha()).status).toBe('PAID')
  })

  test('sem assinatura a situação ainda vem da consulta, e chave desconhecida segue 404', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '9302', status: 'rejected', approvedAt: null }))
    expect(await notificar(c, '9302', { assinatura: false })).toEqual({ status: 200 })
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect(c.fake.calls.map((x) => x.method)).toEqual(['getPayment'])
    expect(await notificar(c, '9302', { assinatura: false, key: 'chave-que-nao-existe-0123456789' })).toEqual({ status: 404 })
  })
})

describe('4. varredura com teto de tempo por rodada', () => {
  test('com 40 s por consulta e teto de 60 s, a rodada confere 2 e deixa o resto para a próxima, sem vencer', async () => {
    const extra = [await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }]), await pedidoComRetirada(c.ctxCliente, [{ productId: c.produto.id, quantity: 1 }])]
    const ids = [c.pedido.id, ...extra.map((e) => e.order.id)]
    for (const id of ids) await prisma.order.update({ where: { id }, data: { mpPreferenceId: `pref-${id}`, checkoutUrl: 'https://mp.test/x' } })
    let relogioMs = 0
    const lento = { ...c.fake, async searchPaymentsByReference(...a: Parameters<typeof c.fake.searchPaymentsByReference>) { relogioMs += 40_000; return c.fake.searchPaymentsByReference(...a) } }
    setIntegrationsForTests({ mercadoPago: lento })
    const depois = new Date(c.now.getTime() + 61 * MIN)
    const r1 = await sweepStore(depois, { budgetMs: 60_000, elapsedMs: () => relogioMs })
    // Os 2 conferidos (sem pagamento) vencem; o terceiro não deu tempo e fica aguardando, sem vencer.
    expect(r1).toEqual({ synced: 2, expired: 2 })
    expect(await prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } })).toBe(1)
    relogioMs = 0
    expect(await sweepStore(depois, { budgetMs: 60_000, elapsedMs: () => relogioMs })).toEqual({ synced: 1, expired: 1 })
    expect(await prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } })).toBe(0)
  })
})

describe('5. cada conta consulta com o token e o segredo dela', () => {
  test('a varredura de duas contas usa um token para cada, nunca o da outra', async () => {
    const b = await cenaLoja()
    await configurarIntegracoes(b.b.id, { mercadoPago: true })
    const pb = await produto(b.dono, { stock: 5 })
    const ob = (await pedidoComRetirada(b.ctxCliente, [{ productId: pb.id, quantity: 1 }])).order
    for (const id of [c.pedido.id, ob.id]) await prisma.order.update({ where: { id }, data: { mpPreferenceId: `pref-${id}`, checkoutUrl: 'https://mp.test/x' } })
    expect(mpTokenDe(c.b.id)).not.toBe(mpTokenDe(b.b.id))
    await sweepStore(new Date(c.now.getTime() + 61 * MIN))
    const porReferencia = c.fake.calls.map((x) => x.accessToken).sort()
    expect(porReferencia).toEqual([mpTokenDe(c.b.id), mpTokenDe(b.b.id)].sort())
  })
})

describe('6. anonimizar com pedido de entrega aguardando pagamento', () => {
  test('é recusado com a mesma mensagem; pedido de retirada aguardando não impede', async () => {
    await prisma.order.update({ where: { id: c.pedido.id }, data: { deliveryMethod: 'SHIPPING', shippingServiceName: 'PAC', shippingDays: 7 } })
    await expect(anonymizeCustomer(c.ctxCliente, c.cliente.id)).rejects.toMatchObject({ code: 'conflict', message: 'Conclua ou cancele os pedidos em andamento antes.' })
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).anonymizedAt).toBeNull()
    await cancelOrder(c.ctxCliente, c.pedido.id)
    await anonymizeCustomer(c.ctxCliente, c.cliente.id)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).anonymizedAt).not.toBeNull()
  })

  test('retirada aguardando pagamento não bloqueia', async () => {
    await anonymizeCustomer(c.ctxCliente, c.cliente.id)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).anonymizedAt).not.toBeNull()
  })
})

describe('8. prazo mínimo de pagamento de 30 minutos (Pix)', () => {
  const CONFIG = { pickupEnabled: true, pickupInstructions: null, shippingEnabled: false, originPostalCode: null, defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 } }

  test('o domínio e o banco recusam menos de 30', async () => {
    await expect(updateStoreSettings(c.dono, 0, { ...CONFIG, paymentWindowMin: 29 })).rejects.toMatchObject({ code: 'validation', fields: { paymentWindowMin: expect.any(String) } })
    await updateStoreSettings(c.dono, 0, { ...CONFIG, paymentWindowMin: 30 })
    expect((await prisma.storeSettings.findUniqueOrThrow({ where: { businessId: c.b.id } })).paymentWindowMin).toBe(30)
    await expect(prisma.storeSettings.update({ where: { businessId: c.b.id }, data: { paymentWindowMin: 29 } })).rejects.toThrow()
  })

  test('a preferência vence em max(prazo do pedido, agora + 30 min)', async () => {
    await prisma.order.update({ where: { id: c.pedido.id }, data: { expiresAt: new Date(c.now.getTime() + 10 * MIN) } })
    await startCheckout(c.ctxCliente, c.pedido.id)
    expect(c.fake.preferences[0]?.expiresAt).toEqual(new Date(c.now.getTime() + 30 * MIN))
    const outro = (await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }])).order
    await startCheckout(c.ctxOutro, outro.id)
    expect(c.fake.preferences[1]?.expiresAt).toEqual(outro.expiresAt)
  })
})

describe('3. limite do webhook por IP e chave', () => {
  test('uma chave que estourou o limite não segura as outras contas do mesmo IP', async () => {
    const b = await cenaPagamento()
    const { POST } = await import('@/app/api/v1/webhooks/mercadopago/[webhookKey]/route')
    const chamar = (key: string) =>
      POST(new Request(`http://api.localhost:3000/v1/webhooks/mercadopago/${key}?type=merchant_order`, { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.50' } }), { params: Promise.resolve({ webhookKey: key }) })
    for (let i = 0; i < 120; i++) expect((await chamar(c.webhookKey)).status).toBe(200)
    expect((await chamar(c.webhookKey)).status).toBe(429)
    expect((await chamar(b.webhookKey)).status).toBe(200)
  })
})
