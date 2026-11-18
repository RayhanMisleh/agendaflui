import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { cancelOrder, createOrder } from '@/server/domain/store/orders'
import { expireOverdueOrders } from '@/server/domain/store/expiry'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { cenaLoja, ctxDoCliente, produto, type CenaLoja } from '../setup/store'
import { estoque, pedidoComRetirada } from '../setup/store-orders'
import { makeCustomer } from '../setup/factories'

// Concorrência de verdade: várias chamadas ao mesmo tempo no mesmo banco. Cada teste prova o resultado final pelo que está
// GRAVADO (estoque, linhas de pedido, números), nunca só pelo que as chamadas devolveram.

beforeEach(resetDb)

let c: CenaLoja
beforeEach(async () => {
  setIntegrationsForTests(null)
  c = await cenaLoja()
})

const ok = <T,>(r: PromiseSettledResult<T>[]) => r.filter((x): x is PromiseFulfilledResult<T> => x.status === 'fulfilled')
const razoes = (r: PromiseSettledResult<unknown>[]) => r.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => (x.reason as { reason?: string; message?: string }).reason ?? (x.reason as Error).message)

describe('estoque sob concorrência', () => {
  test('estoque 2 e dois pedidos simultâneos de 2: um passa, o outro é out_of_stock, estoque 0', async () => {
    const p = await produto(c.dono, { stock: 2 })
    const r = await Promise.allSettled([pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }]), pedidoComRetirada(c.ctxOutro, [{ productId: p.id, quantity: 2 }])])
    expect(ok(r)).toHaveLength(1)
    expect(razoes(r)).toEqual(['out_of_stock'])
    expect(await estoque(p.id)).toBe(0)
    expect(await prisma.order.count()).toBe(1)
    expect(await prisma.orderItem.count()).toBe(1)
  })

  test('estoque 3 e dez pedidos de 1 ao mesmo tempo: exatamente 3 passam e o estoque nunca fica negativo', async () => {
    const p = await produto(c.dono, { stock: 3 })
    const clientes = await Promise.all(Array.from({ length: 10 }, async (_, i) => ctxDoCliente(c.b, await makeCustomer(c.b.id, { name: `Cliente ${i}` }), c.now)))
    const r = await Promise.allSettled(clientes.map((ctx) => pedidoComRetirada(ctx, [{ productId: p.id, quantity: 1 }])))
    expect(ok(r)).toHaveLength(3)
    expect(new Set(razoes(r))).toEqual(new Set(['out_of_stock']))
    expect(await estoque(p.id)).toBe(0)
    expect(await prisma.order.count()).toBe(3)
    const itens = await prisma.orderItem.aggregate({ _sum: { quantity: true } })
    expect(itens._sum.quantity).toBe(3)
  })

  test('pedidos com os mesmos produtos em ordem trocada não travam um no outro e o estoque fecha', async () => {
    const a = await produto(c.dono, { name: 'A', stock: 10 })
    const b = await produto(c.dono, { name: 'B', stock: 10 })
    const clientes = await Promise.all(Array.from({ length: 8 }, async (_, i) => ctxDoCliente(c.b, await makeCustomer(c.b.id, { name: `Cliente ${i}` }), c.now)))
    const r = await Promise.allSettled(
      clientes.map((ctx, i) =>
        pedidoComRetirada(ctx, i % 2 === 0 ? [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }] : [{ productId: b.id, quantity: 1 }, { productId: a.id, quantity: 1 }]),
      ),
    )
    expect(ok(r)).toHaveLength(8)
    expect(await estoque(a.id)).toBe(2)
    expect(await estoque(b.id)).toBe(2)
  })

  test('um pedido com falha numa linha não deixa a outra linha reservada, mesmo com concorrência', async () => {
    const a = await produto(c.dono, { name: 'A', stock: 5 })
    const b = await produto(c.dono, { name: 'B', stock: 1 })
    const clientes = await Promise.all(Array.from({ length: 6 }, async (_, i) => ctxDoCliente(c.b, await makeCustomer(c.b.id, { name: `Cliente ${i}` }), c.now)))
    const r = await Promise.allSettled(clientes.map((ctx) => pedidoComRetirada(ctx, [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }])))
    expect(ok(r)).toHaveLength(1)
    expect(await estoque(a.id)).toBe(4)
    expect(await estoque(b.id)).toBe(0)
  })
})

describe('número do pedido sob concorrência', () => {
  test('dez pedidos simultâneos ganham números sequenciais sem repetição (com produtos diferentes, que não se travam entre si)', async () => {
    // Produtos diferentes: nenhuma linha de estoque é compartilhada, então só a trava da loja impede dois pedidos de pegar o mesmo número.
    const produtos = await Promise.all(Array.from({ length: 10 }, (_, i) => produto(c.dono, { name: `Produto ${i}`, stock: 5 })))
    const clientes = await Promise.all(Array.from({ length: 10 }, async (_, i) => ctxDoCliente(c.b, await makeCustomer(c.b.id, { name: `Cliente ${i}` }), c.now)))
    const r = await Promise.allSettled(clientes.map((ctx, i) => pedidoComRetirada(ctx, [{ productId: produtos[i]?.id ?? '', quantity: 1 }])))
    expect(ok(r)).toHaveLength(10)
    const numeros = (await prisma.order.findMany({ where: { businessId: c.b.id }, select: { number: true }, orderBy: { number: 'asc' } })).map((o) => o.number)
    expect(numeros).toEqual(Array.from({ length: 10 }, (_, i) => 1001 + i))
  })
})

describe('Idempotency-Key sob concorrência', () => {
  test('a mesma chave em cinco chamadas simultâneas gera um pedido só e uma reserva só', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 2 }], { idempotencyKey: 'mesma-chave' })))
    const bons = ok(r)
    expect(bons).toHaveLength(5)
    expect(new Set(bons.map((x) => x.value.order.id)).size).toBe(1)
    expect(bons.filter((x) => !x.value.replayed)).toHaveLength(1)
    expect(await prisma.order.count()).toBe(1)
    expect(await estoque(p.id)).toBe(8)
  })

  test('chaves diferentes do mesmo cliente criam pedidos diferentes', async () => {
    const p = await produto(c.dono, { stock: 10 })
    const r = await Promise.allSettled(['k1', 'k2', 'k3'].map((k) => pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 1 }], { idempotencyKey: k })))
    expect(ok(r)).toHaveLength(3)
    expect(await prisma.order.count()).toBe(3)
    expect(await estoque(p.id)).toBe(7)
  })
})

describe('devolução de estoque sob concorrência', () => {
  async function pedido(quantity = 3, stock = 10) {
    const p = await produto(c.dono, { stock })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity }])
    return { p, order }
  }

  test('quatro cancelamentos simultâneos do mesmo pedido: um vale e o estoque volta uma vez só', async () => {
    const { p, order } = await pedido()
    expect(await estoque(p.id)).toBe(7)
    const r = await Promise.allSettled([cancelOrder(c.ctxCliente, order.id), cancelOrder(c.ctxCliente, order.id), cancelOrder(c.dono, order.id), cancelOrder(c.gerente, order.id)])
    expect(ok(r)).toHaveLength(1)
    expect(new Set(razoes(r))).toEqual(new Set(['invalid_transition']))
    expect(await estoque(p.id)).toBe(10)
  })

  test('cancelar e vencer ao mesmo tempo: o estoque volta uma vez só', async () => {
    const { p, order } = await pedido()
    await prisma.order.update({ where: { id: order.id }, data: { expiresAt: new Date(c.now.getTime() - 1000) } })
    const r = await Promise.allSettled([cancelOrder(c.ctxCliente, order.id), expireOverdueOrders(c.dono), cancelOrder(c.dono, order.id), expireOverdueOrders(c.dono)])
    // Cancelar pode perder para o vencimento (invalid_transition); o que não pode é devolver duas vezes.
    expect(razoes(r.filter((_, i) => i === 0 || i === 2)).every((x) => x === 'invalid_transition')).toBe(true)
    expect(await estoque(p.id)).toBe(10)
    const linha = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(['CANCELED', 'EXPIRED']).toContain(linha.status)
    expect(linha.stockReleasedAt).not.toBeNull()
  })

  test('três varreduras simultâneas vencem o pedido uma vez e devolvem o estoque uma vez', async () => {
    const { p, order } = await pedido()
    await prisma.order.update({ where: { id: order.id }, data: { expiresAt: new Date(c.now.getTime() - 1000) } })
    const r = await Promise.allSettled([expireOverdueOrders(c.dono), expireOverdueOrders(c.gerente), expireOverdueOrders(c.dono)])
    expect(ok(r).map((x) => x.value).reduce((a, b) => a + b, 0)).toBe(1)
    expect(await estoque(p.id)).toBe(10)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('EXPIRED')
  })

  test('devolução e nova reserva ao mesmo tempo mantêm a conta do estoque exata', async () => {
    const p = await produto(c.dono, { stock: 4 })
    const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: 4 }])
    expect(await estoque(p.id)).toBe(0)
    const novos = await Promise.all(Array.from({ length: 4 }, async (_, i) => ctxDoCliente(c.b, await makeCustomer(c.b.id, { name: `Cliente ${i}` }), c.now)))
    const [cancelamento, ...compras_] = await Promise.allSettled([cancelOrder(c.ctxCliente, order.id), ...novos.map((ctx) => createOrder(ctx, { lines: [{ productId: p.id, quantity: 2 }], delivery: { method: 'PICKUP' }, note: null }))])
    const compras = compras_.filter((x) => x.status === 'fulfilled')
    // Depois do cancelamento há 4 unidades: no máximo duas compras de 2; antes dele, nenhuma.
    expect(compras.length).toBeLessThanOrEqual(2)
    const reservado = compras.length * 2
    expect(await estoque(p.id)).toBe(cancelamento?.status === 'fulfilled' ? 4 - reservado : 0)
  })
})
