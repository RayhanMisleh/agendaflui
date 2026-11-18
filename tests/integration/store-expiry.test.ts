import { beforeEach, describe, expect, test } from 'vitest'
import { createSystemContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { expireOverdueOrders } from '@/server/domain/store/expiry'
import { orderVoided } from '@/server/domain/store/order-events'
import { cancelOrder, getOrder } from '@/server/domain/store/orders'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { makeCustomer } from '../setup/factories'
import { domainError } from '../setup/expect'
import { cenaLoja, ctxDoCliente, produto, type CenaLoja } from '../setup/store'
import { estoque, marcarPago, pedidoComRetirada } from '../setup/store-orders'

beforeEach(resetDb)

let c: CenaLoja
beforeEach(async () => {
  setIntegrationsForTests(null)
  c = await cenaLoja()
})

const MIN = 60_000
const depois = (min: number) => new Date(c.now.getTime() + min * MIN)

describe('expireOverdueOrders', () => {
  test('vence só o pedido vencido, devolve o estoque dele e não toca no que ainda está no prazo', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const velho = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 3 }])
    const novo = await pedidoComRetirada(await ctxDoCliente(c.b, c.outro, depois(30)), [{ productId: p.id, quantity: 2 }])
    expect(await estoque(p.id)).toBe(5)
    // 61 minutos depois: o primeiro (prazo de 60 min) venceu; o segundo (criado aos 30 min) tem até os 90.
    const sistema = await createSystemContext(c.b.id, () => depois(61))
    expect(await expireOverdueOrders(sistema)).toBe(1)
    expect(await estoque(p.id)).toBe(8)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: velho.order.id } })).status).toBe('EXPIRED')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: novo.order.id } })).status).toBe('AWAITING_PAYMENT')
    const linha = await prisma.order.findUniqueOrThrow({ where: { id: velho.order.id } })
    expect(linha.stockReleasedAt).toEqual(depois(61))
    expect(linha.canceledAt).toBeNull()
  })

  test('rodar de novo não devolve outra vez e conta zero', async () => {
    const p = await produto(c.dono, { stock: 10 })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 3 }])
    const sistema = await createSystemContext(c.b.id, () => depois(61))
    expect(await expireOverdueOrders(sistema)).toBe(1)
    expect(await expireOverdueOrders(sistema)).toBe(0)
    expect(await expireOverdueOrders(sistema)).toBe(0)
    expect(await estoque(p.id)).toBe(10)
  })

  test('no instante exato do vencimento o pedido já vence (expires_at menor ou igual a agora)', async () => {
    const p = await produto(c.dono, { stock: 10 })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect(await expireOverdueOrders(await createSystemContext(c.b.id, () => depois(60) ))).toBe(1)
    const q = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    expect(await expireOverdueOrders(await createSystemContext(c.b.id, () => new Date(c.now.getTime() + 60 * MIN - 1)))).toBe(0)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: q.order.id } })).status).toBe('AWAITING_PAYMENT')
  })

  test('pedido pago, cancelado ou já vencido não é tocado', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const pago = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const cancelado = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await marcarPago(pago.order.id)
    await cancelOrder(c.ctxCliente, cancelado.order.id)
    const antes = await estoque(p.id)
    expect(await expireOverdueOrders(await createSystemContext(c.b.id, () => depois(500)))).toBe(0)
    expect(await estoque(p.id)).toBe(antes)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pago.order.id } })).status).toBe('PAID')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: cancelado.order.id } })).status).toBe('CANCELED')
  })

  test('com a Loja desligada o vencimento ainda acontece (dinheiro e estoque não esperam o módulo)', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 4 }])
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect(await expireOverdueOrders(await createSystemContext(c.b.id, () => depois(61)))).toBe(1)
    expect(await estoque(p.id)).toBe(10)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('EXPIRED')
    // Já a leitura continua recusada com o módulo desligado.
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: true } })
    expect((await getOrder(c.ctxCliente, order.id)).status).toBe('EXPIRED')
  })

  test('só a conta do contexto é varrida: pedido vencido de outra conta não muda', async () => {
    const p = await produto(c.dono, { stock: 10 })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    const b2 = await cenaLoja()
    const p2 = await produto(b2.dono, { stock: 10 })
    const doB = await pedidoComRetirada(b2.ctxCliente, [{ productId: p2.id, quantity: 2 }])
    expect(await expireOverdueOrders(await createSystemContext(c.b.id, () => depois(61)))).toBe(1)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: doB.order.id } })).status).toBe('AWAITING_PAYMENT')
    expect(await estoque(p2.id)).toBe(8)
  })

  test('muitos pedidos vencidos de uma vez: todos vencem e cada estoque volta uma vez', async () => {
    const p = await produto(c.dono, { stock: 120 })
    // Até 3 pedidos abertos por cliente: 12 pedidos de 4 clientes.
    const clientes = [c.ctxCliente, c.ctxOutro, await ctxDoCliente(c.b, await makeCustomer(c.b.id)), await ctxDoCliente(c.b, await makeCustomer(c.b.id))]
    for (let i = 0; i < 12; i++) await pedidoComRetirada(clientes[i % 4]!, [{ productId: p.id, quantity: 5 }])
    expect(await estoque(p.id)).toBe(60)
    expect(await expireOverdueOrders(await createSystemContext(c.b.id, () => depois(61)))).toBe(12)
    expect(await estoque(p.id)).toBe(120)
  })

  test('o vencimento deixa auditoria, e um pedido vencido não cancela de novo nem volta a aguardar pagamento', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await expireOverdueOrders(await createSystemContext(c.b.id, () => depois(61)))
    expect(await prisma.auditLog.count({ where: { businessId: c.b.id, action: 'order.expired', targetId: order.id } })).toBe(1)
    expect((await domainError(cancelOrder(c.dono, order.id))).reason).toBe('invalid_transition')
    const view = await getOrder(c.ctxCliente, order.id)
    expect(view).toMatchObject({ status: 'EXPIRED', canCancel: false, canPay: false })
  })
})

describe('createSystemContext', () => {
  test('aceita conta ativa, suspensa e arquivada (pagamento já feito não espera reativação)', async () => {
    for (const status of ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const) {
      await prisma.business.update({ where: { id: c.b.id }, data: { status } })
      const ctx = await createSystemContext(c.b.id)
      expect(ctx).toMatchObject({ businessId: c.b.id, timeZone: 'America/Manaus', actor: { kind: 'system' }, channel: 'system' })
    }
  })

  test('o relógio vale e conta inexistente ou id inválido é not_found', async () => {
    const t = new Date('2030-01-01T00:00:00Z')
    expect((await createSystemContext(c.b.id, () => t)).clock()).toEqual(t)
    expect((await domainError(createSystemContext('00000000-0000-4000-8000-000000000000'))).code).toBe('not_found')
    expect((await domainError(createSystemContext('nao-uuid'))).code).toBe('not_found')
  })

  test('a varredura funciona com a conta suspensa', async () => {
    const p = await produto(c.dono, { stock: 10 })
    await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }])
    await prisma.business.update({ where: { id: c.b.id }, data: { status: 'SUSPENDED' } })
    expect(await expireOverdueOrders(await createSystemContext(c.b.id, () => depois(61)))).toBe(1)
    expect(await estoque(p.id)).toBe(10)
  })
})

describe('orderVoided (efeito único de fechar um pedido)', () => {
  const fecha = async (orderId: string) => {
    const sistema = await createSystemContext(c.b.id, () => depois(5))
    await sistema.db.$transaction(async (tx) => {
      await orderVoided(tx, sistema, orderId, 'canceled')
    })
  }

  test('chamar duas vezes (ou mais) devolve o estoque uma vez só', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 4 }])
    await fecha(order.id)
    await fecha(order.id)
    await Promise.all([fecha(order.id), fecha(order.id)])
    expect(await estoque(p.id)).toBe(10)
    const linha = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(linha.stockReleasedAt).toEqual(depois(5))
    expect(await prisma.auditLog.count({ where: { businessId: c.b.id, action: 'order.stock_released' } })).toBe(1)
  })

  test('pedido pago cuja entrega já saiu de PENDING não devolve, e não grava a devolução', async () => {
    const p = await produto(c.dono, { stock: 10 })
    for (const fulfillment of ['READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'] as const) {
      const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }])
      await marcarPago(order.id, { fulfillment })
      await fecha(order.id)
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).stockReleasedAt, fulfillment).toBeNull()
    }
    expect(await estoque(p.id)).toBe(7)
  })

  test('pedido pago com a entrega PENDING devolve; pedido que não existe não faz nada', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 3 }])
    await marcarPago(order.id)
    await fecha(order.id)
    expect(await estoque(p.id)).toBe(10)
    await fecha('00000000-0000-4000-8000-000000000000')
    expect(await estoque(p.id)).toBe(10)
  })

  test('só mexe nos produtos do pedido', async () => {
    const a = await produto(c.dono, { name: 'A', stock: 10 })
    const b = await produto(c.dono, { name: 'B', stock: 10 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: a.id, quantity: 2 }])
    await fecha(order.id)
    expect(await estoque(a.id)).toBe(10)
    expect(await estoque(b.id)).toBe(10)
  })
})
