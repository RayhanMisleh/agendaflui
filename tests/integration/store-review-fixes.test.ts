import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { anonymizeCustomer } from '@/server/domain/customers/customers'
import { createAddress, deleteAddress, listAddresses } from '@/server/domain/store/addresses'
import { advanceFulfillment, cancelOrder, createOrder } from '@/server/domain/store/orders'
import { updateProduct } from '@/server/domain/store/products'
import { readQuote, signQuote } from '@/server/domain/store/quote-token'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { cenaLoja, produto, type CenaLoja } from '../setup/store'
import { cotar, ENDERECO, enderecoDe, estoque, marcarPago, pedidoComRetirada, prepararEntrega } from '../setup/store-orders'
import { makeCustomer } from '../setup/factories'
import { ctxDoCliente } from '../setup/loyalty'

beforeEach(resetDb)
let c: CenaLoja
beforeEach(async () => {
  setIntegrationsForTests(null)
  c = await cenaLoja()
})

const MIN = 60_000
const MENSAGEM_TETO = 'Você já tem pedidos esperando pagamento. Pague ou cancele um deles.'

describe('teto de pedidos aguardando pagamento por cliente', () => {
  test('o 4º pedido é recusado com a mensagem, sem reservar estoque; cancelar um libera', async () => {
    const p = await produto(c.dono, { stock: 20 })
    const feitos = []
    for (let i = 0; i < 3; i++) feitos.push((await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }])).order)
    expect(await estoque(p.id)).toBe(14)
    const e = await domainError(pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }]))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('too_many_open_orders')
    expect(e.message).toBe(MENSAGEM_TETO)
    expect(await estoque(p.id)).toBe(14)
    expect(await prisma.order.count()).toBe(3)
    await cancelOrder(c.ctxCliente, feitos[0]!.id)
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }])
    expect(await prisma.order.count()).toBe(4)
  })

  test('vale por cliente; pedido pago, vencido (mesmo sem varrer) e a repetição da mesma chave não contam contra o teto', async () => {
    const p = await produto(c.dono, { stock: 30 })
    const meus = []
    for (let i = 0; i < 3; i++) meus.push((await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }], { idempotencyKey: `chave-${i}` })).order)
    // outro cliente não é afetado
    await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }])
    // a mesma chave de um pedido que já existe devolve o pedido, mesmo no teto
    const repetido = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }], { idempotencyKey: 'chave-0' })
    expect(repetido.replayed).toBe(true)
    // pago sai da conta
    await marcarPago(meus[0]!.id)
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    // vencido e ainda não varrido (ex.: Mercado Pago fora do ar) também não prende o cliente
    await prisma.order.update({ where: { id: meus[1]!.id }, data: { expiresAt: new Date(c.now.getTime() - MIN) } })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect((await domainError(pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }]))).reason).toBe('too_many_open_orders')
  })

  test('concorrência: 6 pedidos do mesmo cliente ao mesmo tempo, só 3 passam', async () => {
    const p = await produto(c.dono, { stock: 50 })
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])))
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(3)
    expect(r.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => (x.reason as { reason?: string }).reason)).toEqual(['too_many_open_orders', 'too_many_open_orders', 'too_many_open_orders'])
    expect(await prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } })).toBe(3)
    expect(await estoque(p.id)).toBe(47)
  })
})

describe('updateProduct não grava estoque às cegas', () => {
  test('stock sem expectedStock é recusado e o estoque não muda; com expectedStock certo vale', async () => {
    const p = await produto(c.dono, { stock: 10 })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 3 }])
    const e = await domainError(updateProduct(c.dono, p.id, { stock: 10 }))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {})).toEqual(['stock'])
    expect(await estoque(p.id)).toBe(7)
    await expect(updateProduct(c.dono, p.id, { stock: 20, expectedStock: 7 })).resolves.toMatchObject({ stock: 20 })
    expect((await domainError(updateProduct(c.dono, p.id, { stock: 5, expectedStock: 7 }))).reason).toBe('changed')
    expect(await estoque(p.id)).toBe(20)
  })
})

describe('cotação de outra conta e de outro cliente (cada guarda isolada)', () => {
  async function cena() {
    await prepararEntrega(c)
    const { updateStoreSettings } = await import('@/server/domain/store/settings')
    await updateStoreSettings(c.dono, 1, { pickupEnabled: true, pickupInstructions: null, shippingEnabled: true, originPostalCode: '01310100', defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 }, paymentWindowMin: 60 })
    const p = await produto(c.dono, { stock: 20 })
    const addressId = await enderecoDe(c.ctxCliente)
    const lines = [{ productId: p.id, quantity: 1 }]
    const valido = readQuote(await cotar(c.ctxCliente, addressId, lines))
    if (valido === null) throw new Error('cotação de teste inválida')
    const pedir = (token: string) => createOrder(c.ctxCliente, { lines, delivery: { method: 'SHIPPING', addressId, quoteToken: token }, note: null })
    return { p, valido, pedir }
  }

  test('só o businessId diferente: invalid_quote', async () => {
    const x = await cena()
    const e = await domainError(x.pedir(signQuote({ ...x.valido, businessId: '11111111-1111-4111-8111-111111111111' })))
    expect(e.reason).toBe('invalid_quote')
    expect(await estoque(x.p.id)).toBe(20)
  })

  test('só o customerId diferente: invalid_quote', async () => {
    const x = await cena()
    const e = await domainError(x.pedir(signQuote({ ...x.valido, customerId: c.outro.id })))
    expect(e.reason).toBe('invalid_quote')
    expect(await estoque(x.p.id)).toBe(20)
  })

  test('a cotação assinada igual em tudo vale (controle)', async () => {
    const x = await cena()
    await expect(x.pedir(signQuote(x.valido))).resolves.toMatchObject({ replayed: false })
  })
})

describe('anonimizar cliente com pedido em andamento', () => {
  const MENSAGEM = 'Conclua ou cancele os pedidos em andamento antes.'

  test('pedido pago ainda não entregue ou retirado: recusado e nada é apagado', async () => {
    const p = await produto(c.dono, { stock: 20 })
    await createAddress(c.ctxCliente, ENDERECO)
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await marcarPago(order.id)
    for (const etapa of ['PENDING', 'READY_FOR_PICKUP'] as const) {
      if (etapa === 'READY_FOR_PICKUP') await advanceFulfillment(c.dono, order.id, { to: 'READY_FOR_PICKUP' })
      const e = await domainError(anonymizeCustomer(c.dono, c.cliente.id))
      expect(e.code).toBe('conflict')
      expect(e.message).toBe(MENSAGEM)
      const cliente = await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })
      expect(cliente.anonymizedAt).toBeNull()
      expect(cliente.name).toBe('Maria da Silva')
      expect(await prisma.address.count({ where: { customerId: c.cliente.id } })).toBe(1)
    }
    // o próprio cliente apagando a conta também é recusado
    expect((await domainError(anonymizeCustomer(c.ctxCliente, c.cliente.id))).message).toBe(MENSAGEM)
  })

  test('depois de entregue, cancelado ou sem pagar, anonimiza normalmente', async () => {
    const p = await produto(c.dono, { stock: 20 })
    const entregue = (await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])).order
    await marcarPago(entregue.id, { fulfillment: 'DELIVERED' })
    const cancelado = (await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])).order
    await cancelOrder(c.ctxCliente, cancelado.id)
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await anonymizeCustomer(c.dono, c.cliente.id)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).anonymizedAt).not.toBeNull()
  })

  test('pedido em andamento de outro cliente não atrapalha', async () => {
    const p = await produto(c.dono, { stock: 20 })
    const dele = (await pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 1 }])).order
    await marcarPago(dele.id)
    const livre = await makeCustomer(c.b.id, { name: 'Sem pedidos' })
    await anonymizeCustomer(c.dono, livre.id)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: livre.id } })).anonymizedAt).not.toBeNull()
    expect(await ctxDoCliente(c.b, c.outro)).toBeDefined()
  })
})

describe('apagar o endereço padrão', () => {
  test('promove o mais recente que sobrou; apagar outro não muda o padrão', async () => {
    const a = await createAddress(c.ctxCliente, { ...ENDERECO, label: 'A', isDefault: true })
    const b = await createAddress(c.ctxCliente, { ...ENDERECO, label: 'B', isDefault: false })
    const d = await createAddress(c.ctxCliente, { ...ENDERECO, label: 'D', isDefault: false })
    await prisma.address.update({ where: { id: a.id }, data: { createdAt: new Date(c.now.getTime() - 3 * MIN) } })
    await prisma.address.update({ where: { id: b.id }, data: { createdAt: new Date(c.now.getTime() - 2 * MIN) } })
    await prisma.address.update({ where: { id: d.id }, data: { createdAt: new Date(c.now.getTime() - 1 * MIN) } })
    await deleteAddress(c.ctxCliente, b.id)
    expect((await listAddresses(c.ctxCliente)).find((x) => x.isDefault)?.id).toBe(a.id)
    const e = await createAddress(c.ctxCliente, { ...ENDERECO, label: 'E', isDefault: false })
    await deleteAddress(c.ctxCliente, a.id)
    const lista = await listAddresses(c.ctxCliente)
    expect(lista.filter((x) => x.isDefault).map((x) => x.id)).toEqual([e.id])
    await deleteAddress(c.ctxCliente, e.id)
    await deleteAddress(c.ctxCliente, d.id)
    expect(await listAddresses(c.ctxCliente)).toEqual([])
  })

  test('endereço de outro cliente continua intocado', async () => {
    const meu = await createAddress(c.ctxCliente, { ...ENDERECO, isDefault: true })
    const dele = await createAddress(c.ctxOutro, { ...ENDERECO, isDefault: true })
    await deleteAddress(c.ctxCliente, meu.id)
    expect((await listAddresses(c.ctxOutro)).map((x) => [x.id, x.isDefault])).toEqual([[dele.id, true]])
  })
})
