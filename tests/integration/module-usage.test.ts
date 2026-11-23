import { beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { getModuleUsage } from '@/server/domain/platform/module-usage'
import { createPrize } from '@/server/domain/loyalty/prizes'
import { redeemPrize } from '@/server/domain/loyalty/redemptions'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'
import { lancar } from '../setup/loyalty'
import { configurarIntegracoes } from '../setup/store'
import { pedidoComRetirada, marcarPago } from '../setup/store-orders'
import { cenaLoja, produto } from '../setup/store'

type Admin = Extract<Actor, { kind: 'platform_admin' }>
let admin: Admin

beforeEach(async () => {
  await resetDb()
  const a = await makePlatformAdmin()
  admin = { kind: 'platform_admin', adminId: a.id, name: a.name }
})

describe('getModuleUsage', () => {
  test('conta só o que é da própria conta: pedidos a entregar e resgates pendentes', async () => {
    const a = await cenaLoja()
    const b = await cenaLoja()
    await configurarIntegracoes(a.b.id, { mercadoPago: true })
    await configurarIntegracoes(b.b.id, { mercadoPago: true })
    // Conta A: um pedido de produto pago e a entregar, um já entregue, um aguardando pagamento; 1 resgate pendente.
    const p = await produto(a.dono, { stock: 10 })
    const aEntregar = await pedidoComRetirada(a.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await marcarPago(aEntregar.order.id)
    const entregue = await pedidoComRetirada(a.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await marcarPago(entregue.order.id, { fulfillment: 'DELIVERED' })
    await pedidoComRetirada(a.ctxCliente, [{ productId: p.id, quantity: 1 }])
    await prisma.businessModules.update({ where: { businessId: a.b.id }, data: { loyalty: true } })
    await lancar(a.b.id, a.cliente.id, 100)
    const prize = await createPrize(a.dono, { name: 'Brinde', description: null, costPoints: 40, stock: null, active: true })
    await redeemPrize(a.ctxCliente, { prizeId: prize.id })
    // Conta B: um pedido pago a entregar (não pode aparecer na conta A).
    const pb = await produto(b.dono, { stock: 10 })
    const deB = await pedidoComRetirada(b.ctxCliente, [{ productId: pb.id, quantity: 1 }])
    await marcarPago(deB.order.id)

    expect(await getModuleUsage(admin, a.b.id)).toEqual({ openOrders: 1, pendingRedemptions: 1, mercadoPagoConfigured: true })
    expect(await getModuleUsage(admin, b.b.id)).toEqual({ openOrders: 1, pendingRedemptions: 0, mercadoPagoConfigured: true })
  })

  test('conta nova: tudo zero e Mercado Pago não configurado; configurar só um dos segredos não conta', async () => {
    const b = await makeBusiness()
    expect(await getModuleUsage(admin, b.id)).toEqual({ openOrders: 0, pendingRedemptions: 0, mercadoPagoConfigured: false })
    await configurarIntegracoes(b.id, { mercadoPago: true })
    expect((await getModuleUsage(admin, b.id)).mercadoPagoConfigured).toBe(true)
  })

  test('recusa quem não é admin da plataforma e conta que não existe', async () => {
    const b = await makeBusiness()
    const intruso = { kind: 'guest' } as unknown as Admin
    expect((await domainError(getModuleUsage(intruso, b.id))).code).toBe('forbidden')
    expect((await domainError(getModuleUsage(admin, '00000000-0000-4000-8000-000000000000'))).code).toBe('not_found')
    expect((await domainError(getModuleUsage(admin, 'lixo'))).code).toBe('not_found')
  })
})
