import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { anonymizeCustomer } from '@/server/domain/customers/customers'
import { updateAddress } from '@/server/domain/store/addresses'
import { advanceFulfillment, cancelOrder, createOrder, getOrder, listOrders } from '@/server/domain/store/orders'
import { updateProduct } from '@/server/domain/store/products'
import { updateStoreSettings } from '@/server/domain/store/settings'
import { createGuestContext } from '@/server/auth/guest-context'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { cenaLoja, ctxDoCliente, produto, type CenaLoja } from '../setup/store'
import { cotar, enderecoDe, estoque, marcarPago, pedidoComRetirada, prepararEntrega } from '../setup/store-orders'

beforeEach(resetDb)

let c: CenaLoja
beforeEach(async () => {
  setIntegrationsForTests(null)
  c = await cenaLoja()
})

const camposDe = (e: { fields?: Record<string, string> }) => Object.keys(e.fields ?? {})
const CONFIG = { pickupEnabled: true, pickupInstructions: 'Retire na recepção.', shippingEnabled: false, originPostalCode: null, defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 }, paymentWindowMin: 60 }
const MIN = 60_000

describe('pedido com retirada', () => {
  test('o total é a soma dos preços do banco (a promoção vale) e o pedido nasce aguardando pagamento', async () => {
    await updateStoreSettings(c.dono, 0, CONFIG)
    const a = await produto(c.dono, { name: 'Pomada', priceCents: 3000, promoPriceCents: 2500, stock: 10 })
    const b = await produto(c.dono, { name: 'Gel', priceCents: 1000, stock: 5 })
    const { order, replayed } = await pedidoComRetirada(c.ctxCliente, [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 3 }], { note: '  Deixar na portaria  ' })
    expect(replayed).toBe(false)
    expect(order).toMatchObject({
      number: 1001,
      status: 'AWAITING_PAYMENT',
      fulfillmentStatus: 'PENDING',
      deliveryMethod: 'PICKUP',
      itemsCents: 2 * 2500 + 3 * 1000,
      shippingCents: 0,
      totalCents: 8000,
      shipping: null,
      address: null,
      pickupInstructions: 'Retire na recepção.',
      customer: { id: c.cliente.id, name: 'Maria da Silva' },
      customerNote: 'Deixar na portaria',
      paidLabel: null,
      canceledLabel: null,
      cancelReason: null,
      attention: null,
      canCancel: true,
      canPay: true,
    })
    expect(order.items).toEqual([
      { kind: 'product', id: a.id, name: 'Pomada', unitPriceCents: 2500, quantity: 2, totalCents: 5000 },
      { kind: 'product', id: b.id, name: 'Gel', unitPriceCents: 1000, quantity: 3, totalCents: 3000 },
    ])
    expect(order.expiresAt).toEqual(new Date(c.now.getTime() + 60 * MIN))
    expect(order.createdLabel).toMatch(/^17\/11\/2026/)
    expect(await estoque(a.id)).toBe(8)
    expect(await estoque(b.id)).toBe(2)
    expect(await prisma.auditLog.count({ where: { businessId: c.b.id, action: 'order.created' } })).toBe(1)
  })

  test('os pedidos seguintes ganham 1002, 1003... e o prazo para pagar vem das configurações', async () => {
    await updateStoreSettings(c.dono, 0, { ...CONFIG, paymentWindowMin: 30 })
    const p = await produto(c.dono, { stock: 10 })
    const a = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const b = await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }])
    expect([a.order.number, b.order.number]).toEqual([1001, 1002])
    expect(a.order.expiresAt).toEqual(new Date(c.now.getTime() + 30 * MIN))
  })

  test('o número é sequencial por conta (a conta B também começa em 1001)', async () => {
    const p = await produto(c.dono)
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const b2 = await cenaLoja()
    const p2 = await produto(b2.dono)
    expect((await pedidoComRetirada(b2.ctxCliente, [{ productId: p2.id, quantity: 1 }])).order.number).toBe(1001)
  })

  test('o pedido guarda o nome e o preço da compra: mudar o produto depois não muda o pedido', async () => {
    const p = await produto(c.dono, { name: 'Shampoo', priceCents: 2500, stock: 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }])
    await updateProduct(c.dono, p.id, { name: 'Shampoo Premium', priceCents: 9900 })
    const lido = await getOrder(c.ctxCliente, order.id)
    expect(lido.items[0]).toMatchObject({ name: 'Shampoo', unitPriceCents: 2500, totalCents: 5000 })
    expect(lido.totalCents).toBe(5000)
    const novo = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect(novo.order.totalCents).toBe(9900)
  })

  test('retirada desligada: pickup_unavailable e nada é reservado', async () => {
    await prepararEntrega(c)
    await updateStoreSettings(c.dono, 1, { ...CONFIG, pickupEnabled: false, shippingEnabled: true, originPostalCode: '01310100' })
    const p = await produto(c.dono, { stock: 4 })
    const e = await domainError(pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }]))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('pickup_unavailable')
    expect(await prisma.order.count()).toBe(0)
    expect(await estoque(p.id)).toBe(4)
  })

  test('com a retirada ligada por padrão (sem linha de configurações) o pedido passa', async () => {
    const p = await produto(c.dono)
    expect((await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])).order.status).toBe('AWAITING_PAYMENT')
  })

  test('entrega NONE é sempre recusada nesta fase (todo produto é físico)', async () => {
    const p = await produto(c.dono)
    const e = await domainError(createOrder(c.ctxCliente, { lines: [{ productId: p.id, quantity: 1 }], delivery: { method: 'NONE' }, note: null }))
    expect(e.code).toBe('validation')
    expect(camposDe(e)).toEqual(['delivery'])
    expect(await prisma.order.count()).toBe(0)
  })

  test('entradas ruins: carrinho vazio, observação longa, forma de entrega desconhecida, chave de idempotência malformada', async () => {
    const p = await produto(c.dono)
    const lines = [{ productId: p.id, quantity: 1 }]
    expect(camposDe(await domainError(pedidoComRetirada(c.ctxCliente, [])))).toContain('lines')
    expect(camposDe(await domainError(pedidoComRetirada(c.ctxCliente, lines, { note: 'x'.repeat(301) })))).toEqual(['note'])
    expect(camposDe(await domainError(createOrder(c.ctxCliente, { lines, delivery: { method: 'CORREIO' } as never, note: null }))).every((k) => k.startsWith('delivery'))).toBe(true)
    expect(camposDe(await domainError(pedidoComRetirada(c.ctxCliente, lines, { idempotencyKey: 'chave com espaço' })))).toEqual(['idempotencyKey'])
    expect(await prisma.order.count()).toBe(0)
  })

  test('só o cliente do app faz pedido: equipe e visitante são recusados; módulo desligado recusa', async () => {
    const p = await produto(c.dono)
    const lines = [{ productId: p.id, quantity: 1 }]
    const visitante = await createGuestContext({ businessId: c.b.id, timeZone: 'America/Manaus', request: { ip: null, userAgent: null } })
    expect((await domainError(pedidoComRetirada(c.dono, lines))).code).toBe('forbidden')
    expect((await domainError(pedidoComRetirada(visitante, lines))).code).toBe('forbidden')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(pedidoComRetirada(c.ctxCliente, lines))).code).toBe('module_disabled')
    expect(await prisma.order.count()).toBe(0)
  })

  test('o banco confere a conta: total diferente de itens + frete e total zero são recusados', async () => {
    const p = await produto(c.dono)
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await expect(prisma.order.update({ where: { id: order.id }, data: { totalCents: 1 } })).rejects.toThrow()
    await expect(prisma.order.update({ where: { id: order.id }, data: { itemsCents: 0, totalCents: 0 } })).rejects.toThrow()
    await expect(prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { totalCents: 1 } })).rejects.toThrow()
    await expect(prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { quantity: 100, totalCents: 100 * order.items[0]!.unitPriceCents } })).rejects.toThrow()
  })
})

describe('estoque reservado', () => {
  test('estoque insuficiente: out_of_stock com o nome do produto e NADA gravado (nem o estoque das outras linhas)', async () => {
    const ok = await produto(c.dono, { name: 'Pomada', stock: 5 })
    const pouco = await produto(c.dono, { name: 'Gel raro', stock: 1 })
    const e = await domainError(pedidoComRetirada(c.ctxCliente, [{ productId: ok.id, quantity: 3 }, { productId: pouco.id, quantity: 2 }]))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('out_of_stock')
    expect(e.message).toContain('Gel raro')
    expect(await estoque(ok.id)).toBe(5)
    expect(await estoque(pouco.id)).toBe(1)
    expect(await prisma.order.count()).toBe(0)
    expect(await prisma.orderItem.count()).toBe(0)
    // O número não foi consumido.
    expect((await pedidoComRetirada(c.ctxCliente, [{ productId: ok.id, quantity: 1 }])).order.number).toBe(1001)
  })

  test('pedir exatamente o que há leva o estoque a zero; depois disso, acabou', async () => {
    const p = await produto(c.dono, { name: 'Último', stock: 2 })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }])
    expect(await estoque(p.id)).toBe(0)
    const e = await domainError(pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }]))
    expect(e.reason).toBe('out_of_stock')
    expect(e.message).toContain('Último')
  })

  test('produto desativado ou arquivado entre o carrinho e o pedido não é vendido', async () => {
    const p = await produto(c.dono, { stock: 3 })
    await updateProduct(c.dono, p.id, { active: false })
    const e = await domainError(pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }]))
    expect(e.code).toBe('validation')
    expect(await estoque(p.id)).toBe(3)
  })
})

describe('Idempotency-Key', () => {
  test('a mesma chave com o mesmo pedido devolve o original e reserva uma vez só', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const a = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }], { idempotencyKey: 'abc-123' })
    const b = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }], { idempotencyKey: 'abc-123' })
    expect(a.replayed).toBe(false)
    expect(b.replayed).toBe(true)
    expect(b.order.id).toBe(a.order.id)
    expect(await prisma.order.count()).toBe(1)
    expect(await estoque(p.id)).toBe(8)
  })

  test('a repetição responde com o que foi pedido da primeira vez, mesmo depois de o preço ou o estoque mudarem', async () => {
    const p = await produto(c.dono, { priceCents: 1000, stock: 2 })
    const a = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }], { idempotencyKey: 'k1' })
    await updateProduct(c.dono, p.id, { priceCents: 5000 })
    const b = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }], { idempotencyKey: 'k1' })
    expect(b.replayed).toBe(true)
    expect(b.order.totalCents).toBe(a.order.totalCents)
  })

  test('mesma chave com outro pedido: idempotency_key_reused e nada novo', async () => {
    const p = await produto(c.dono, { stock: 10 })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }], { idempotencyKey: 'k1' })
    for (const outro of [[{ productId: p.id, quantity: 3 }], [{ productId: p.id, quantity: 2 }, { productId: (await produto(c.dono, { name: 'Outro' })).id, quantity: 1 }]]) {
      const e = await domainError(pedidoComRetirada(c.ctxCliente, outro, { idempotencyKey: 'k1' }))
      expect(e.code).toBe('conflict')
      expect(e.reason).toBe('idempotency_key_reused')
    }
    const nota = await domainError(pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }], { idempotencyKey: 'k1', note: 'outra observação' }))
    expect(nota.reason).toBe('idempotency_key_reused')
    expect(await prisma.order.count()).toBe(1)
    expect(await estoque(p.id)).toBe(8)
  })

  test('a chave é de cada cliente; chave com mais de 24 h é liberada', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const a = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }], { idempotencyKey: 'k1' })
    const b = await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }], { idempotencyKey: 'k1' })
    expect(b.replayed).toBe(false)
    expect(b.order.id).not.toBe(a.order.id)
    const amanha = await ctxDoCliente(c.b, c.cliente, new Date(c.now.getTime() + 25 * 60 * MIN))
    const c2 = await pedidoComRetirada(amanha, [{ productId: p.id, quantity: 1 }], { idempotencyKey: 'k1' })
    expect(c2.replayed).toBe(false)
    expect(c2.order.id).not.toBe(a.order.id)
    expect(await prisma.order.count()).toBe(3)
  })
})

describe('pedido com entrega e cotação assinada', () => {
  async function cenaEntrega() {
    await prepararEntrega(c)
    await updateStoreSettings(c.dono, 1, { ...CONFIG, shippingEnabled: true, originPostalCode: '01310100' })
    const p = await produto(c.dono, { name: 'Pomada', priceCents: 2500, stock: 20 })
    const addressId = await enderecoDe(c.ctxCliente)
    const lines = [{ productId: p.id, quantity: 2 }]
    return { p, addressId, lines }
  }
  const entregar = (ctx: typeof c.ctxCliente, lines: { productId: string; quantity: number }[], addressId: string, quoteToken: string, o: { idempotencyKey?: string } = {}) =>
    createOrder(ctx, { lines, delivery: { method: 'SHIPPING', addressId, quoteToken }, note: null, ...o })

  test('com o token certo: total = itens + frete do token, e o pedido copia o endereço e o serviço', async () => {
    const { addressId, lines } = await cenaEntrega()
    const token = await cotar(c.ctxCliente, addressId, lines, 'SEDEX')
    const { order } = await entregar(c.ctxCliente, lines, addressId, token)
    expect(order).toMatchObject({
      deliveryMethod: 'SHIPPING',
      itemsCents: 5000,
      shippingCents: 3890,
      totalCents: 8890,
      shipping: { serviceName: 'SEDEX', days: 3, trackingCode: null },
      address: { recipientName: 'Maria da Silva', postalCode: '20040020', street: 'Rua da Quitanda', number: '10', complement: 'Sala 2', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ' },
      pickupInstructions: null,
    })
    const linha = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(linha).toMatchObject({ shippingServiceCode: 'SEDEX', shippingServiceName: 'SEDEX', shippingDays: 3, shipPostalCode: '20040020', shipRecipient: 'Maria da Silva' })
  })

  test('mudar o endereço depois do pedido não muda a cópia no pedido', async () => {
    const { addressId, lines } = await cenaEntrega()
    const { order } = await entregar(c.ctxCliente, lines, addressId, await cotar(c.ctxCliente, addressId, lines))
    await updateAddress(c.ctxCliente, addressId, { street: 'Rua Nova', number: '99' })
    expect((await getOrder(c.ctxCliente, order.id)).address).toMatchObject({ street: 'Rua da Quitanda', number: '10' })
  })

  test.each([
    ['de outro carrinho (quantidade diferente)', async (x: Awaited<ReturnType<typeof cenaEntrega>>) => ({ lines: [{ productId: x.p.id, quantity: 3 }], addressId: x.addressId, token: await cotar(c.ctxCliente, x.addressId, x.lines) })],
    ['de outro endereço', async (x: Awaited<ReturnType<typeof cenaEntrega>>) => {
      const outro = await enderecoDe(c.ctxCliente, { number: '77', isDefault: false })
      return { lines: x.lines, addressId: outro, token: await cotar(c.ctxCliente, x.addressId, x.lines) }
    }],
    ['de outro cliente', async (x: Awaited<ReturnType<typeof cenaEntrega>>) => {
      const dele = await enderecoDe(c.ctxOutro)
      return { lines: x.lines, addressId: dele, token: await cotar(c.ctxCliente, x.addressId, x.lines), ctx: c.ctxOutro }
    }],
    ['com o CEP do endereço alterado depois da cotação', async (x: Awaited<ReturnType<typeof cenaEntrega>>) => {
      const token = await cotar(c.ctxCliente, x.addressId, x.lines)
      await updateAddress(c.ctxCliente, x.addressId, { postalCode: '30140-071' })
      return { lines: x.lines, addressId: x.addressId, token }
    }],
    ['texto qualquer', async (x: Awaited<ReturnType<typeof cenaEntrega>>) => ({ lines: x.lines, addressId: x.addressId, token: 'v1.abc.def' })],
    ['com um caractere trocado', async (x: Awaited<ReturnType<typeof cenaEntrega>>) => {
      const t = await cotar(c.ctxCliente, x.addressId, x.lines)
      return { lines: x.lines, addressId: x.addressId, token: `${t.slice(0, 20)}${t[20] === 'A' ? 'B' : 'A'}${t.slice(21)}` }
    }],
  ])('quoteToken %s: invalid_quote, nada reservado e nada gravado', async (_nome, monta) => {
    const x = await cenaEntrega()
    const { lines, addressId, token, ctx } = (await monta(x)) as { lines: typeof x.lines; addressId: string; token: string; ctx?: typeof c.ctxCliente }
    const e = await domainError(entregar(ctx ?? c.ctxCliente, lines, addressId, token))
    expect(e.reason).toBe('invalid_quote')
    expect(e.code).toBe('validation')
    expect(await estoque(x.p.id)).toBe(20)
    expect(await prisma.order.count()).toBe(0)
  })

  test('quoteToken de outra conta: invalid_quote', async () => {
    const x = await cenaEntrega()
    const b2 = await cenaLoja()
    await prepararEntrega(b2)
    await updateStoreSettings(b2.dono, 1, { ...CONFIG, shippingEnabled: true, originPostalCode: '01310100' })
    const p2 = await produto(b2.dono, { stock: 5 })
    const addr2 = await enderecoDe(b2.ctxCliente)
    const tokenDeB = await cotar(b2.ctxCliente, addr2, [{ productId: p2.id, quantity: 1 }])
    const e = await domainError(entregar(c.ctxCliente, x.lines, x.addressId, tokenDeB))
    expect(e.reason).toBe('invalid_quote')
    expect(await estoque(x.p.id)).toBe(20)
  })

  test('token com 31 minutos é quote_expired; com 30 minutos exatos ainda vale', async () => {
    const x = await cenaEntrega()
    const token = await cotar(c.ctxCliente, x.addressId, x.lines)
    const em31 = await ctxDoCliente(c.b, c.cliente, new Date(c.now.getTime() + 31 * MIN))
    const e = await domainError(entregar(em31, x.lines, x.addressId, token))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('quote_expired')
    expect(await prisma.order.count()).toBe(0)
    const em30 = await ctxDoCliente(c.b, c.cliente, new Date(c.now.getTime() + 30 * MIN))
    expect((await entregar(em30, x.lines, x.addressId, token)).order.shippingCents).toBe(2150)
    const em30e1 = await ctxDoCliente(c.b, c.cliente, new Date(c.now.getTime() + 30 * MIN + 1))
    expect((await domainError(entregar(em30e1, x.lines, x.addressId, token))).reason).toBe('quote_expired')
  })

  test('entrega desligada depois da cotação: shipping_unavailable', async () => {
    const x = await cenaEntrega()
    const token = await cotar(c.ctxCliente, x.addressId, x.lines)
    await updateStoreSettings(c.dono, 2, { ...CONFIG, shippingEnabled: false })
    const e = await domainError(entregar(c.ctxCliente, x.lines, x.addressId, token))
    expect(e.reason).toBe('shipping_unavailable')
    expect(e.code).toBe('conflict')
    expect(await estoque(x.p.id)).toBe(20)
  })

  test('endereço apagado depois da cotação: not_found', async () => {
    const x = await cenaEntrega()
    const token = await cotar(c.ctxCliente, x.addressId, x.lines)
    await prisma.address.delete({ where: { id: x.addressId } })
    expect((await domainError(entregar(c.ctxCliente, x.lines, x.addressId, token))).code).toBe('not_found')
  })

  test('o pedido de entrega com Idempotency-Key repetido devolve o mesmo pedido', async () => {
    const x = await cenaEntrega()
    const token = await cotar(c.ctxCliente, x.addressId, x.lines)
    const a = await entregar(c.ctxCliente, x.lines, x.addressId, token, { idempotencyKey: 'ent-1' })
    const b = await entregar(c.ctxCliente, x.lines, x.addressId, token, { idempotencyKey: 'ent-1' })
    expect(b.replayed).toBe(true)
    expect(b.order.id).toBe(a.order.id)
    expect(await estoque(x.p.id)).toBe(18)
  })
})

describe('cancelar', () => {
  async function umPedido(o: { quantity?: number; stock?: number } = {}) {
    const p = await produto(c.dono, { stock: o.stock ?? 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: o.quantity ?? 3 }])
    return { p, order }
  }

  test('o cliente cancela o pedido aguardando pagamento: o estoque volta UMA vez; cancelar de novo é invalid_transition', async () => {
    const { p, order } = await umPedido()
    expect(await estoque(p.id)).toBe(7)
    const r = await cancelOrder(c.ctxCliente, order.id, { reason: 'Desisti' })
    expect(r).toMatchObject({ status: 'CANCELED', cancelReason: 'Desisti', canCancel: false, canPay: false })
    expect(r.canceledLabel).toMatch(/^17\/11\/2026/)
    expect(await estoque(p.id)).toBe(10)
    const linha = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(linha).toMatchObject({ canceledByType: 'CUSTOMER', canceledById: c.cliente.id })
    expect(linha.stockReleasedAt).not.toBeNull()
    const de_novo = await domainError(cancelOrder(c.ctxCliente, order.id))
    expect(de_novo.code).toBe('conflict')
    expect(de_novo.reason).toBe('invalid_transition')
    expect(await estoque(p.id)).toBe(10)
  })

  test('o cliente não cancela pedido pago (invalid_transition) e o estoque não muda', async () => {
    const { p, order } = await umPedido()
    await marcarPago(order.id)
    const e = await domainError(cancelOrder(c.ctxCliente, order.id))
    expect(e.reason).toBe('invalid_transition')
    expect(await estoque(p.id)).toBe(7)
    expect((await getOrder(c.ctxCliente, order.id)).status).toBe('PAID')
  })

  test('a equipe cancela pedido pago com a entrega PENDING: o estoque volta; com READY_FOR_PICKUP, SHIPPED ou DELIVERED, não volta', async () => {
    for (const [fulfillment, volta] of [['PENDING', true], ['READY_FOR_PICKUP', false], ['SHIPPED', false], ['DELIVERED', false]] as const) {
      const { p, order } = await umPedido({ stock: 10, quantity: 3 })
      await marcarPago(order.id, { fulfillment })
      const r = await cancelOrder(c.gerente, order.id, { reason: 'Pedido cancelado pelo estabelecimento' })
      expect(r.status, fulfillment).toBe('CANCELED')
      expect(await estoque(p.id), fulfillment).toBe(volta ? 10 : 7)
      const linha = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
      expect(linha.canceledByType).toBe('MEMBER')
      expect(linha.stockReleasedAt !== null, fulfillment).toBe(volta)
    }
  })

  test('a equipe cancela pedido aguardando pagamento; o canCancel da equipe vale para pedido pago', async () => {
    const { p, order } = await umPedido()
    expect((await getOrder(c.dono, order.id)).canCancel).toBe(true)
    await marcarPago(order.id)
    expect((await getOrder(c.dono, order.id)).canCancel).toBe(true)
    expect((await getOrder(c.ctxCliente, order.id)).canCancel).toBe(false)
    await cancelOrder(c.dono, order.id)
    expect(await estoque(p.id)).toBe(10)
  })

  test('pedido vencido ou já cancelado não cancela de novo', async () => {
    const { order } = await umPedido()
    await prisma.order.update({ where: { id: order.id }, data: { status: 'EXPIRED' } })
    expect((await domainError(cancelOrder(c.dono, order.id))).reason).toBe('invalid_transition')
  })

  test('outro cliente, outra conta e id estranho: not_found; profissional: forbidden; módulo desligado recusa', async () => {
    const { order } = await umPedido()
    expect((await domainError(cancelOrder(c.ctxOutro, order.id))).code).toBe('not_found')
    const b2 = await cenaLoja()
    expect((await domainError(cancelOrder(b2.dono, order.id))).code).toBe('not_found')
    expect((await domainError(cancelOrder(c.dono, 'nao-uuid'))).code).toBe('not_found')
    expect((await domainError(cancelOrder(c.profissional, order.id))).code).toBe('forbidden')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(cancelOrder(c.ctxCliente, order.id))).code).toBe('module_disabled')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('AWAITING_PAYMENT')
  })

  test('o motivo é aparado, vazio vira nada e passar de 300 caracteres é validation', async () => {
    const { order } = await umPedido()
    expect(camposDe(await domainError(cancelOrder(c.ctxCliente, order.id, { reason: 'x'.repeat(301) })))).toEqual(['reason'])
    expect((await cancelOrder(c.ctxCliente, order.id, { reason: '   ' })).cancelReason).toBeNull()
  })
})

describe('entrega do pedido (cumprimento)', () => {
  async function pago(o: { entrega?: boolean } = {}) {
    if (o.entrega) {
      await prepararEntrega(c)
      await updateStoreSettings(c.dono, 1, { ...CONFIG, shippingEnabled: true, originPostalCode: '01310100' })
    }
    const p = await produto(c.dono, { stock: 10 })
    const lines = [{ productId: p.id, quantity: 1 }]
    let order
    if (o.entrega) {
      const addressId = await enderecoDe(c.ctxCliente)
      order = (await createOrder(c.ctxCliente, { lines, delivery: { method: 'SHIPPING', addressId, quoteToken: await cotar(c.ctxCliente, addressId, lines) }, note: null })).order
    } else {
      order = (await pedidoComRetirada(c.ctxCliente, lines)).order
    }
    await marcarPago(order.id)
    return order
  }

  test('retirada: PENDING → READY_FOR_PICKUP → DELIVERED, e dá para voltar um passo', async () => {
    const o = await pago()
    expect((await advanceFulfillment(c.dono, o.id, { to: 'READY_FOR_PICKUP' })).fulfillmentStatus).toBe('READY_FOR_PICKUP')
    expect((await advanceFulfillment(c.dono, o.id, { to: 'DELIVERED' })).fulfillmentStatus).toBe('DELIVERED')
    expect((await advanceFulfillment(c.dono, o.id, { to: 'READY_FOR_PICKUP' })).fulfillmentStatus).toBe('READY_FOR_PICKUP')
    expect((await advanceFulfillment(c.dono, o.id, { to: 'PENDING' })).fulfillmentStatus).toBe('PENDING')
  })

  test('retirada: pular passo, ficar onde está ou usar passo de entrega é invalid_transition', async () => {
    const o = await pago()
    for (const to of ['DELIVERED', 'SHIPPED', 'PENDING'] as const) {
      const e = await domainError(advanceFulfillment(c.dono, o.id, { to }))
      expect(e.code, to).toBe('conflict')
      expect(e.reason, to).toBe('invalid_transition')
    }
  })

  test('entrega: PENDING → SHIPPED (com rastreio) → DELIVERED, voltar um passo vale e READY_FOR_PICKUP não existe', async () => {
    const o = await pago({ entrega: true })
    expect((await domainError(advanceFulfillment(c.dono, o.id, { to: 'READY_FOR_PICKUP' }))).reason).toBe('invalid_transition')
    expect((await domainError(advanceFulfillment(c.dono, o.id, { to: 'DELIVERED' }))).reason).toBe('invalid_transition')
    const enviado = await advanceFulfillment(c.dono, o.id, { to: 'SHIPPED', trackingCode: '  AB123456789BR  ' })
    expect(enviado).toMatchObject({ fulfillmentStatus: 'SHIPPED', shipping: { trackingCode: 'AB123456789BR' } })
    expect((await advanceFulfillment(c.dono, o.id, { to: 'DELIVERED' })).fulfillmentStatus).toBe('DELIVERED')
    expect((await advanceFulfillment(c.dono, o.id, { to: 'SHIPPED' })).shipping?.trackingCode).toBe('AB123456789BR')
    expect((await advanceFulfillment(c.dono, o.id, { to: 'PENDING' })).fulfillmentStatus).toBe('PENDING')
  })

  test('código de rastreio: até 40 caracteres, vazio vale, só em SHIPPED', async () => {
    const o = await pago({ entrega: true })
    expect(camposDe(await domainError(advanceFulfillment(c.dono, o.id, { to: 'SHIPPED', trackingCode: 'x'.repeat(41) })))).toEqual(['trackingCode'])
    expect((await advanceFulfillment(c.dono, o.id, { to: 'SHIPPED', trackingCode: 'x'.repeat(40) })).shipping?.trackingCode).toBe('x'.repeat(40))
    await advanceFulfillment(c.dono, o.id, { to: 'PENDING' })
    expect((await advanceFulfillment(c.dono, o.id, { to: 'SHIPPED', trackingCode: '' })).shipping?.trackingCode).toBe('x'.repeat(40))
    const r = await pago()
    expect(camposDe(await domainError(advanceFulfillment(c.dono, r.id, { to: 'READY_FOR_PICKUP', trackingCode: 'AB1' })))).toEqual(['trackingCode'])
  })

  test('só pedido pago muda de etapa (aguardando, cancelado e vencido não)', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect((await domainError(advanceFulfillment(c.dono, order.id, { to: 'READY_FOR_PICKUP' }))).reason).toBe('invalid_transition')
    await marcarPago(order.id)
    await cancelOrder(c.dono, order.id)
    expect((await domainError(advanceFulfillment(c.dono, order.id, { to: 'READY_FOR_PICKUP' }))).reason).toBe('invalid_transition')
  })

  test('cliente e profissional não mudam etapa; outra conta é not_found; etapa desconhecida é validation', async () => {
    const o = await pago()
    expect((await domainError(advanceFulfillment(c.ctxCliente, o.id, { to: 'READY_FOR_PICKUP' }))).code).toBe('forbidden')
    expect((await domainError(advanceFulfillment(c.profissional, o.id, { to: 'READY_FOR_PICKUP' }))).code).toBe('forbidden')
    const b2 = await cenaLoja()
    expect((await domainError(advanceFulfillment(b2.dono, o.id, { to: 'READY_FOR_PICKUP' }))).code).toBe('not_found')
    expect((await domainError(advanceFulfillment(c.dono, o.id, { to: 'EXPLODIU' as never }))).code).toBe('validation')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).fulfillmentStatus).toBe('PENDING')
  })

  test('módulo desligado recusa', async () => {
    const o = await pago()
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(advanceFulfillment(c.dono, o.id, { to: 'READY_FOR_PICKUP' }))).code).toBe('module_disabled')
  })
})

describe('leitura e isolamento', () => {
  test('o cliente lê só os próprios pedidos; pedido de outro cliente e de outra conta é not_found', async () => {
    const p = await produto(c.dono, { stock: 20 })
    const meu = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const dele = await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }])
    expect((await getOrder(c.ctxCliente, meu.order.id)).id).toBe(meu.order.id)
    expect((await domainError(getOrder(c.ctxCliente, dele.order.id))).code).toBe('not_found')
    expect((await listOrders(c.ctxCliente)).items.map((o) => o.id)).toEqual([meu.order.id])
    const b2 = await cenaLoja()
    expect((await domainError(getOrder(b2.dono, meu.order.id))).code).toBe('not_found')
    expect((await domainError(getOrder(b2.ctxCliente, meu.order.id))).code).toBe('not_found')
    expect((await listOrders(b2.dono)).items).toEqual([])
    expect((await domainError(getOrder(c.ctxCliente, 'nao-uuid'))).code).toBe('not_found')
  })

  test('a equipe com manage_store lê todos; profissional e visitante não leem', async () => {
    const p = await produto(c.dono, { stock: 20 })
    const a = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const b = await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }])
    expect((await getOrder(c.gerente, b.order.id)).customer.name).toBe('João Souza')
    expect((await listOrders(c.dono)).items.map((o) => o.id).sort()).toEqual([a.order.id, b.order.id].sort())
    expect((await domainError(listOrders(c.profissional))).code).toBe('forbidden')
    expect((await domainError(getOrder(c.profissional, a.order.id))).code).toBe('forbidden')
    const visitante = await createGuestContext({ businessId: c.b.id, timeZone: 'America/Manaus', request: { ip: null, userAgent: null } })
    expect((await domainError(listOrders(visitante))).code).toBe('forbidden')
  })

  test('lista: mais novo primeiro, filtros por situação, "a entregar", busca e cliente, com cursor', async () => {
    const p = await produto(c.dono, { stock: 50 })
    const mk = async (ctx: typeof c.ctxCliente) => (await pedidoComRetirada(ctx, [{ productId: p.id, quantity: 1 }])).order
    const o1 = await mk(c.ctxCliente)
    const o2 = await mk(c.ctxOutro)
    const o3 = await mk(c.ctxCliente)
    const o4 = await mk(c.ctxCliente)
    await marcarPago(o2.id)
    await marcarPago(o3.id, { fulfillment: 'DELIVERED' })
    await cancelOrder(c.dono, o4.id)
    const numeros = async (q: Parameters<typeof listOrders>[1]) => (await listOrders(c.dono, q)).items.map((o) => o.number)
    expect(await numeros({})).toEqual([o4.number, o3.number, o2.number, o1.number])
    expect(await numeros({ status: 'AWAITING_PAYMENT' })).toEqual([o1.number])
    expect(await numeros({ status: 'PAID' })).toEqual([o3.number, o2.number])
    expect(await numeros({ status: 'CANCELED' })).toEqual([o4.number])
    expect(await numeros({ status: 'to_fulfill' })).toEqual([o2.number])
    expect(await numeros({ search: String(o2.number) })).toEqual([o2.number])
    expect(await numeros({ search: 'joao' })).toEqual([o2.number])
    expect(await numeros({ search: 'maria' })).toEqual([o4.number, o3.number, o1.number])
    expect(await numeros({ customerId: c.outro.id })).toEqual([o2.number])
    const p1 = await listOrders(c.dono, { limit: 3 })
    expect(p1.items).toHaveLength(3)
    const p2 = await listOrders(c.dono, { limit: 3, cursor: p1.nextCursor ?? '' })
    expect(p2.items.map((o) => o.number)).toEqual([o1.number])
    expect(p2.nextCursor).toBeNull()
    expect((await domainError(listOrders(c.dono, { cursor: 'lixo' }))).code).toBe('validation')
    expect((await domainError(listOrders(c.dono, { limit: 101 }))).code).toBe('validation')
    expect((await domainError(listOrders(c.dono, { status: 'EXPLODIU' as never }))).code).toBe('validation')
    // O cliente com customerId de outro continua vendo só os próprios.
    expect((await listOrders(c.ctxCliente, { customerId: c.outro.id })).items.map((o) => o.number)).toEqual([o4.number, o3.number, o1.number])
  })

  test('módulo desligado recusa leitura; a busca com byte zero não derruba', async () => {
    const p = await produto(c.dono, { stock: 5 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect((await listOrders(c.dono, { search: 'a\u0000b' })).items).toEqual([])
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(listOrders(c.dono))).code).toBe('module_disabled')
    expect((await domainError(getOrder(c.ctxCliente, order.id))).code).toBe('module_disabled')
  })

  test('a visão do cliente não carrega nada interno além do que a visão traz (pagar só enquanto aguarda e não venceu)', async () => {
    const p = await produto(c.dono, { stock: 5 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect((await getOrder(c.ctxCliente, order.id)).canPay).toBe(true)
    const depois = await ctxDoCliente(c.b, c.cliente, new Date(c.now.getTime() + 61 * MIN))
    expect((await getOrder(depois, order.id)).canPay).toBe(false)
    expect((await getOrder(c.dono, order.id)).canPay).toBe(false)
  })

  test('anonimizar o cliente limpa o endereço copiado e a observação dos pedidos, e mantém itens e totais', async () => {
    await prepararEntrega(c)
    await updateStoreSettings(c.dono, 1, { ...CONFIG, shippingEnabled: true, originPostalCode: '01310100' })
    const p = await produto(c.dono, { stock: 10, priceCents: 1000 })
    const addressId = await enderecoDe(c.ctxCliente)
    const lines = [{ productId: p.id, quantity: 2 }]
    const { order } = await createOrder(c.ctxCliente, { lines, delivery: { method: 'SHIPPING', addressId, quoteToken: await cotar(c.ctxCliente, addressId, lines) }, note: 'Ligar antes: 11 99999-0000' })
    // Enquanto o pedido de entrega aguarda pagamento, anonimizar é recusado (se o pagamento chegar, a loja precisa do endereço).
    await expect(anonymizeCustomer(c.dono, c.cliente.id)).rejects.toMatchObject({ message: 'Conclua ou cancele os pedidos em andamento antes.' })
    await cancelOrder(c.ctxCliente, order.id)
    await anonymizeCustomer(c.dono, c.cliente.id)
    const linha = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(linha).toMatchObject({ shipRecipient: null, shipPostalCode: null, shipStreet: null, shipNumber: null, shipComplement: null, shipDistrict: null, shipCity: null, shipState: null, customerNote: null })
    expect(linha).toMatchObject({ itemsCents: 2000, shippingCents: 2150, totalCents: 4150, deliveryMethod: 'SHIPPING', shippingServiceName: 'PAC' })
    const lido = await getOrder(c.dono, order.id)
    expect(lido.address).toBeNull()
    expect(lido.customerNote).toBeNull()
    expect(lido.items[0]).toMatchObject({ name: 'Shampoo', quantity: 2 })
    // Pedido de outro cliente não é tocado.
    const outro = await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }], { note: 'Fica' })
    await anonymizeCustomer(c.dono, c.cliente.id)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: outro.order.id } })).customerNote).toBe('Fica')
  })
})
