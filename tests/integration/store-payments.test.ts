import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { expireOverdueOrders } from '@/server/domain/store/expiry'
import { applyPayment, listOrderPayments, syncOrderPayments } from '@/server/domain/store/payments'
import { advanceFulfillment, cancelOrder } from '@/server/domain/store/orders'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { cenaLoja, configurarIntegracoes, produto } from '../setup/store'
import { estoque, pedidoComRetirada } from '../setup/store-orders'
import { cenaPagamento, MP_SEGREDO, MP_TOKEN, notificar, pagamentoMp, type CenaPagamento } from '../setup/store-payments'
import { fakeMercadoPago } from '@/server/integrations/fakes'

beforeEach(resetDb)
beforeEach(() => setIntegrationsForTests(null))

let c: CenaPagamento
const linha = (id = c.pedido.id) => prisma.order.findUniqueOrThrow({ where: { id } })
const sistema = (c2: { b: { id: string } } = c) => createSystemContext(c2.b.id)

describe('applyPayment', () => {
  beforeEach(async () => {
    c = await cenaPagamento()
  })

  test('aprovado com o valor certo: pedido pago, uma linha em payments, estoque ainda reservado', async () => {
    const pg = pagamentoMp(c.pedido)
    const r = await applyPayment(await sistema(), c.pedido.id, pg)
    expect(r).toEqual({ orderStatus: 'PAID', changed: true })
    const o = await linha()
    expect(o.status).toBe('PAID')
    expect(o.paidAt).not.toBeNull()
    expect(o.fulfillmentStatus).toBe('PENDING')
    expect(o.attention).toBeNull()
    expect(await estoque(c.produto.id)).toBe(8)
    const pagamentos = await prisma.payment.findMany()
    expect(pagamentos).toHaveLength(1)
    expect(pagamentos[0]).toMatchObject({ orderId: c.pedido.id, businessId: c.b.id, provider: 'MERCADO_PAGO', providerPaymentId: pg.id, status: 'APPROVED', amountCents: 5000, currency: 'BRL' })
    expect(await prisma.auditLog.count({ where: { action: 'order.paid', targetId: c.pedido.id } })).toBe(1)
  })

  test('o mesmo aviso 3 vezes: uma linha, pedido pago, estoque inalterado e só a primeira muda algo', async () => {
    const pg = pagamentoMp(c.pedido)
    const r = [await applyPayment(await sistema(), c.pedido.id, pg), await applyPayment(await sistema(), c.pedido.id, pg), await applyPayment(await sistema(), c.pedido.id, pg)]
    expect(r.map((x) => x.changed)).toEqual([true, false, false])
    expect(await prisma.payment.count()).toBe(1)
    expect((await linha()).status).toBe('PAID')
    expect(await estoque(c.produto.id)).toBe(8)
    expect(await prisma.auditLog.count({ where: { action: 'order.paid' } })).toBe(1)
  })

  test('R$ 0,01 a menos: pedido continua aguardando, pagamento gravado e atenção amount_mismatch', async () => {
    const r = await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido, { amountCents: 4999 }))
    expect(r.orderStatus).toBe('AWAITING_PAYMENT')
    const o = await linha()
    expect(o.status).toBe('AWAITING_PAYMENT')
    expect(o.attention).toBe('amount_mismatch')
    expect(o.paidAt).toBeNull()
    expect((await prisma.payment.findFirstOrThrow()).amountCents).toBe(4999)
  })

  test('R$ 0,01 a mais e moeda diferente também não pagam', async () => {
    await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido, { amountCents: 5001 }))
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    await prisma.order.update({ where: { id: c.pedido.id }, data: { attention: null } })
    await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido, { currency: 'USD' }))
    const o = await linha()
    expect(o.status).toBe('AWAITING_PAYMENT')
    expect(o.attention).toBe('amount_mismatch')
  })

  test('rejeitado, cancelado, pendente e em processamento: só o pagamento muda', async () => {
    for (const status of ['rejected', 'cancelled', 'pending', 'in_process', 'in_mediation', 'authorized'] as const) {
      await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido, { status, approvedAt: null }))
    }
    const o = await linha()
    expect(o.status).toBe('AWAITING_PAYMENT')
    expect(o.attention).toBeNull()
    expect(await estoque(c.produto.id)).toBe(8)
    expect((await prisma.payment.findMany({ orderBy: { createdAt: 'asc' } })).map((p) => p.status)).toEqual(['REJECTED', 'CANCELED', 'PENDING', 'IN_PROCESS', 'IN_PROCESS', 'IN_PROCESS'])
  })

  test('a situação do pagamento não volta atrás (aviso atrasado não desfaz o que a consulta mais nova disse)', async () => {
    const pg = pagamentoMp(c.pedido)
    await applyPayment(await sistema(), c.pedido.id, pg)
    await applyPayment(await sistema(), c.pedido.id, { ...pg, status: 'pending', approvedAt: null })
    expect((await prisma.payment.findFirstOrThrow()).status).toBe('APPROVED')
    await applyPayment(await sistema(), c.pedido.id, { ...pg, status: 'refunded' })
    expect((await linha()).status).toBe('CANCELED')
    expect(await estoque(c.produto.id)).toBe(10)
    // consulta velha que ainda dizia "aprovado" chega depois do estorno: ignorada, pedido não reabre
    const velha = await applyPayment(await sistema(), c.pedido.id, pg)
    expect(velha.changed).toBe(false)
    expect((await prisma.payment.findFirstOrThrow()).status).toBe('REFUNDED')
    expect((await linha()).status).toBe('CANCELED')
    expect(await estoque(c.produto.id)).toBe(10)
  })

  test('pagamento que já pertence a outro pedido nunca muda este', async () => {
    const outro = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }])
    const pg = pagamentoMp(c.pedido)
    await applyPayment(await sistema(), c.pedido.id, pg)
    const r = await applyPayment(await sistema(), outro.order.id, { ...pg, amountCents: outro.order.totalCents, externalReference: outro.order.id })
    expect(r).toEqual({ orderStatus: 'AWAITING_PAYMENT', changed: false })
    expect((await linha(outro.order.id)).status).toBe('AWAITING_PAYMENT')
    expect(await prisma.payment.count()).toBe(1)
    expect((await prisma.payment.findFirstOrThrow()).orderId).toBe(c.pedido.id)
  })

  test('pedido de outra conta: not_found', async () => {
    const outra = await cenaLoja()
    await expect(applyPayment(await sistema(outra), c.pedido.id, pagamentoMp(c.pedido))).rejects.toMatchObject({ code: 'not_found' })
    expect(await prisma.payment.count()).toBe(0)
  })

  describe('pago depois de vencer ou cancelar', () => {
    const vencer = async () => {
      await prisma.order.update({ where: { id: c.pedido.id }, data: { expiresAt: new Date(c.now.getTime() - 1000) } })
      expect(await expireOverdueOrders(await sistema())).toBe(1)
      expect(await estoque(c.produto.id)).toBe(10)
    }

    test('vencido com estoque: vira pago e baixa o estoque de novo', async () => {
      await vencer()
      const r = await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido))
      expect(r).toEqual({ orderStatus: 'PAID', changed: true })
      const o = await linha()
      expect(o).toMatchObject({ status: 'PAID', attention: null, stockReleasedAt: null })
      expect(await estoque(c.produto.id)).toBe(8)
    })

    test('cancelado pelo cliente com estoque: vira pago, limpa o cancelamento e baixa o estoque', async () => {
      await cancelOrder(c.ctxCliente, c.pedido.id, { reason: 'desisti' })
      const r = await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido))
      expect(r.orderStatus).toBe('PAID')
      const o = await linha()
      expect(o).toMatchObject({ status: 'PAID', canceledAt: null, canceledByType: null, cancelReason: null, stockReleasedAt: null })
      expect(await estoque(c.produto.id)).toBe(8)
    })

    test('sem estoque: vira pago com stock_shortfall, estoque intocado, e cancelar depois não devolve o que nunca saiu', async () => {
      await vencer()
      const outro = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 10 }])
      expect(await estoque(c.produto.id)).toBe(0)
      const r = await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido))
      expect(r.orderStatus).toBe('PAID')
      const o = await linha()
      expect(o.attention).toBe('stock_shortfall')
      expect(o.stockReleasedAt).not.toBeNull()
      expect(await estoque(c.produto.id)).toBe(0)
      await cancelOrder(c.dono, c.pedido.id)
      expect(await estoque(c.produto.id)).toBe(0)
      expect(outro.order.status).toBe('AWAITING_PAYMENT')
    })

    test('com vários itens, falta de um deles não deixa reserva parcial', async () => {
      const b = await produto(c.dono, { stock: 5, name: 'Pente' })
      const dois = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }, { productId: b.id, quantity: 2 }])
      await prisma.order.update({ where: { id: dois.order.id }, data: { expiresAt: new Date(c.now.getTime() - 1000) } })
      await expireOverdueOrders(await sistema())
      const antesA = await estoque(c.produto.id)
      await prisma.product.update({ where: { id: b.id }, data: { stock: 1 } })
      await applyPayment(await sistema(), dois.order.id, pagamentoMp(dois.order))
      expect((await linha(dois.order.id)).attention).toBe('stock_shortfall')
      expect(await estoque(c.produto.id)).toBe(antesA)
      expect(await estoque(b.id)).toBe(1)
    })
  })

  describe('estorno e contestação', () => {
    test('pedido pago e ainda não separado: cancelado, estoque devolvido uma vez, motivo e sem atenção', async () => {
      const pg = pagamentoMp(c.pedido)
      await applyPayment(await sistema(), c.pedido.id, pg)
      expect(await estoque(c.produto.id)).toBe(8)
      for (let i = 0; i < 3; i++) await applyPayment(await sistema(), c.pedido.id, { ...pg, status: 'refunded' })
      const o = await linha()
      expect(o).toMatchObject({ status: 'CANCELED', cancelReason: 'Pagamento devolvido no Mercado Pago', attention: null, canceledByType: 'SYSTEM' })
      expect(o.canceledAt).not.toBeNull()
      expect(await estoque(c.produto.id)).toBe(10)
    })

    test('chargeback cancela do mesmo jeito', async () => {
      const pg = pagamentoMp(c.pedido)
      await applyPayment(await sistema(), c.pedido.id, pg)
      await applyPayment(await sistema(), c.pedido.id, { ...pg, status: 'charged_back' })
      expect((await linha()).status).toBe('CANCELED')
      expect((await prisma.payment.findFirstOrThrow()).status).toBe('CHARGED_BACK')
      expect(await estoque(c.produto.id)).toBe(10)
    })

    test('entrega já saiu de pendente: cancela, não devolve o estoque e marca payment_reversed', async () => {
      const pg = pagamentoMp(c.pedido)
      await applyPayment(await sistema(), c.pedido.id, pg)
      await advanceFulfillment(c.dono, c.pedido.id, { to: 'READY_FOR_PICKUP' })
      await applyPayment(await sistema(), c.pedido.id, { ...pg, status: 'refunded' })
      const o = await linha()
      expect(o.status).toBe('CANCELED')
      expect(o.attention).toBe('payment_reversed')
      expect(await estoque(c.produto.id)).toBe(8)
    })

    test('estorno de pedido que não estava pago não mexe no pedido', async () => {
      await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido, { status: 'refunded' }))
      expect((await linha()).status).toBe('AWAITING_PAYMENT')
      expect(await estoque(c.produto.id)).toBe(8)
    })

    test('estorno de um pagamento extra não cancela o pedido que outro pagamento aprovado cobre', async () => {
      await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido))
      const extra = pagamentoMp(c.pedido)
      await applyPayment(await sistema(), c.pedido.id, extra)
      await applyPayment(await sistema(), c.pedido.id, { ...extra, status: 'refunded' })
      expect((await linha()).status).toBe('PAID')
      expect(await estoque(c.produto.id)).toBe(8)
    })
  })

  test('com a Loja desligada e a conta suspensa o pagamento ainda vale', async () => {
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    await prisma.business.update({ where: { id: c.b.id }, data: { status: 'SUSPENDED' } })
    expect((await applyPayment(await sistema(), c.pedido.id, pagamentoMp(c.pedido))).orderStatus).toBe('PAID')
  })
})

describe('listOrderPayments', () => {
  test('lista os pagamentos do pedido com situação, valor, identificador e quando; só com manage_store', async () => {
    c = await cenaPagamento()
    const pg = pagamentoMp(c.pedido)
    await applyPayment(await sistema(), c.pedido.id, pg)
    const l = await listOrderPayments(c.dono, c.pedido.id)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ status: 'APPROVED', amountCents: 5000, providerPaymentId: pg.id })
    expect(l[0]!.updatedLabel).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    await expect(listOrderPayments(c.profissional, c.pedido.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(listOrderPayments(c.ctxCliente, c.pedido.id)).rejects.toMatchObject({ code: 'forbidden' })
    const outra = await cenaLoja()
    await expect(listOrderPayments(outra.dono, c.pedido.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('syncOrderPayments', () => {
  beforeEach(async () => {
    c = await cenaPagamento()
  })

  test('acha o pagamento aprovado pela referência e paga o pedido', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido))
    expect(await syncOrderPayments(await sistema(), c.pedido.id)).toBe(true)
    expect((await linha()).status).toBe('PAID')
    expect(c.fake.calls.map((x) => x.method)).toEqual(['searchPaymentsByReference'])
    expect(c.fake.calls[0]!.accessToken).toBe(MP_TOKEN)
  })

  test('sem pagamento algum: consulta ok (true) e o pedido não muda', async () => {
    expect(await syncOrderPayments(await sistema(), c.pedido.id)).toBe(true)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('Mercado Pago fora do ar, ou sem configuração: false e nada muda', async () => {
    c.fake.failWith('unavailable')
    expect(await syncOrderPayments(await sistema(), c.pedido.id)).toBe(false)
    c.fake.failWith(null)
    await prisma.businessIntegration.update({ where: { businessId: c.b.id }, data: { mpAccessTokenEnc: null, mpAccessTokenLast4: null } })
    expect(await syncOrderPayments(await sistema(), c.pedido.id)).toBe(false)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('ignora resultado cuja referência é de outro pedido', async () => {
    const outro = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }])
    c.fake.registerPayment(pagamentoMp(outro.order), { searchableAs: c.pedido.id })
    expect(await syncOrderPayments(await sistema(), c.pedido.id)).toBe(true)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect((await linha(outro.order.id)).status).toBe('AWAITING_PAYMENT')
    expect(await prisma.payment.count()).toBe(0)
  })
})

describe('handleMercadoPagoNotification', () => {
  beforeEach(async () => {
    c = await cenaPagamento()
  })

  test('sem assinatura: 401 e nenhuma consulta ao Mercado Pago', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '555' }))
    expect(await notificar(c, '555', { assinatura: false })).toEqual({ status: 401 })
    expect(c.fake.calls).toHaveLength(0)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('assinatura com o segredo de outra conta: 401 sem consulta', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '555' }))
    const outra = await cenaLoja()
    await configurarIntegracoes(outra.b.id, { mercadoPago: true })
    expect(await notificar(c, '555', { secret: 'outrosegredo0123456789abcd' })).toEqual({ status: 401 })
    expect(c.fake.calls).toHaveLength(0)
  })

  test('webhookKey de outra conta (segredo igual): 200 e o pedido desta conta não muda', async () => {
    const outra = await cenaLoja()
    await configurarIntegracoes(outra.b.id, { mercadoPago: true })
    const chaveDeB = (await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId: outra.b.id } })).mpWebhookKey!
    // mesmo segredo no teste (configurarIntegracoes usa valores fixos): a conta B abre com o segredo dela e consulta com o token DELA
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '556' }))
    expect(await notificar(c, '556', { key: chaveDeB })).toEqual({ status: 200 })
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('webhookKey inexistente ou malformada: 404', async () => {
    expect(await notificar(c, '555', { key: 'chave-que-nao-existe-0123456789' })).toEqual({ status: 404 })
    expect(await notificar(c, '555', { key: '' })).toEqual({ status: 404 })
    expect(c.fake.calls).toHaveLength(0)
  })

  test('assinatura certa e pagamento aprovado com o valor certo: pedido pago e uma linha em payments', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '777' }))
    expect(await notificar(c, '777')).toEqual({ status: 200 })
    expect((await linha()).status).toBe('PAID')
    expect(await prisma.payment.count()).toBe(1)
    expect(c.fake.calls.map((x) => [x.method, x.accessToken])).toEqual([['getPayment', MP_TOKEN]])
  })

  test('a mesma notificação 3 vezes em sequência: um pagamento, pedido pago, estoque igual', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '778' }))
    for (let i = 0; i < 3; i++) expect(await notificar(c, '778')).toEqual({ status: 200 })
    expect(await prisma.payment.count()).toBe(1)
    expect((await linha()).status).toBe('PAID')
    expect(await estoque(c.produto.id)).toBe(8)
  })

  test('a situação vem da consulta: o que o aviso diz não conta (consulta rejeitada, pedido não muda)', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '779', status: 'rejected', approvedAt: null }))
    expect(await notificar(c, '779')).toEqual({ status: 200 })
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    expect((await prisma.payment.findFirstOrThrow()).status).toBe('REJECTED')
  })

  test('referência a pedido de outra conta: 200 e nada muda em B', async () => {
    const outra = await cenaLoja()
    const pb = await produto(outra.dono, { stock: 5 })
    const pedidoB = await pedidoComRetirada(outra.ctxCliente, [{ productId: pb.id, quantity: 1 }])
    c.fake.registerPayment(pagamentoMp(pedidoB.order, { id: '780' }))
    expect(await notificar(c, '780')).toEqual({ status: 200 })
    expect((await linha(pedidoB.order.id)).status).toBe('AWAITING_PAYMENT')
    expect(await prisma.payment.count()).toBe(0)
  })

  test('referência desconhecida, ausente ou que não é pedido: 200 sem mudar nada', async () => {
    for (const [i, ref] of [['781', '11111111-1111-4111-8111-111111111111'], ['782', null], ['783', 'nao-e-pedido']] as const) {
      c.fake.registerPayment(pagamentoMp(c.pedido, { id: i, externalReference: ref }))
      expect(await notificar(c, i)).toEqual({ status: 200 })
    }
    expect(await prisma.payment.count()).toBe(0)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
  })

  test('consulta falhando: 503 e nada gravado', async () => {
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '784' }))
    c.fake.failWith('unavailable')
    expect(await notificar(c, '784')).toEqual({ status: 503 })
    expect(await prisma.payment.count()).toBe(0)
    expect((await linha()).status).toBe('AWAITING_PAYMENT')
    c.fake.failWith(null)
    expect(await notificar(c, '784')).toEqual({ status: 200 })
    expect((await linha()).status).toBe('PAID')
  })

  test('pagamento que o Mercado Pago não conhece: 503 (tentará de novo)', async () => {
    expect(await notificar(c, '99999')).toEqual({ status: 503 })
  })

  test('type diferente de payment, ausente, ou data.id ausente: 200 sem consulta', async () => {
    expect(await notificar(c, '785', { type: 'merchant_order' })).toEqual({ status: 200 })
    expect(await notificar(c, '785', { type: null })).toEqual({ status: 200 })
    expect(await notificar(c, null)).toEqual({ status: 200 })
    expect(c.fake.calls).toHaveLength(0)
  })

  test('data.id com formato estranho, mesmo assinado: 200 sem consulta (nunca vira caminho de URL)', async () => {
    expect(await notificar(c, '../../x')).toEqual({ status: 200 })
    expect(c.fake.calls).toHaveLength(0)
  })

  test('Loja desligada e conta suspensa: o webhook ainda processa', async () => {
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    await prisma.business.update({ where: { id: c.b.id }, data: { status: 'SUSPENDED' } })
    c.fake.registerPayment(pagamentoMp(c.pedido, { id: '790' }))
    expect(await notificar(c, '790')).toEqual({ status: 200 })
    expect((await linha()).status).toBe('PAID')
  })

  test('segredo nunca vai para log nem para a resposta', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    c.fake.failWith('unavailable')
    const r = await notificar(c, '791')
    await notificar(c, '791', { assinatura: false })
    await notificar(c, '792', { key: 'nenhuma-chave-assim-0123456789' })
    const tudo = JSON.stringify([log.mock.calls, info.mock.calls, aviso.mock.calls, r])
    for (const s of [MP_TOKEN, MP_SEGREDO, c.webhookKey]) expect(tudo).not.toContain(s)
    vi.restoreAllMocks()
  })
})

describe('sem integração do Mercado Pago na conta', () => {
  test('webhookKey de conta sem segredos legíveis: 404', async () => {
    const c2 = await cenaLoja()
    setIntegrationsForTests({ mercadoPago: fakeMercadoPago() })
    expect(await notificar({ webhookKey: 'x' }, '1')).toEqual({ status: 404 })
    expect(c2.b.id).toBeDefined()
  })
})
