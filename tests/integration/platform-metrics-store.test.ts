import { beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { getAccountMetrics, getOverview } from '@/server/domain/platform/metrics'
import { fromIsoInstant } from '@/server/time'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makePlatformAdmin } from '../setup/factories'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

// Segunda-feira, 16/11/2026, 12:00 em São Paulo. Mês atual: 01/11 a 16/11; mesmo trecho do mês passado: 01/10 a 16/10.
const NOW = fromIsoInstant('2026-11-16T15:00:00.000Z')
const at = (s: string) => fromIsoInstant(s)

let actor: PlatformAdminActor
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
})

async function loja(o: { store: boolean; timezone?: string; status?: 'ACTIVE' | 'ARCHIVED' }) {
  const b = await makeBusiness({ ...(o.timezone ? { timezone: o.timezone } : {}), ...(o.status ? { status: o.status } : {}) })
  await prisma.businessModules.upsert({ where: { businessId: b.id }, create: { businessId: b.id, store: o.store }, update: { store: o.store } })
  const c = await makeCustomer(b.id)
  let numero = 1000
  const pedido = (p: { status?: 'PAID' | 'AWAITING_PAYMENT' | 'CANCELED'; paidAt?: Date | null; totalCents: number }) =>
    prisma.order.create({
      data: {
        businessId: b.id,
        number: (numero += 1),
        customerId: c.id,
        status: p.status ?? 'PAID',
        deliveryMethod: 'PICKUP',
        itemsCents: p.totalCents,
        totalCents: p.totalCents,
        expiresAt: at('2027-01-01T00:00:00.000Z'),
        ...(p.paidAt === null ? {} : { paidAt: p.paidAt ?? at('2026-11-10T15:00:00.000Z') }),
        ...(p.status === 'CANCELED' ? { canceledAt: at('2026-11-11T15:00:00.000Z'), canceledByType: 'SYSTEM' as const } : {}),
      },
    })
  return { b, pedido }
}

describe('volume da loja no getOverview', () => {
  test('conta pedidos pagos e receita do mês, do trecho do mês passado e do mês passado inteiro, só de contas com Loja ligada', async () => {
    const a = await loja({ store: true })
    await a.pedido({ totalCents: 10_000, paidAt: at('2026-11-10T15:00:00.000Z') })
    await a.pedido({ totalCents: 2_500, paidAt: at('2026-11-01T03:00:00.000Z') })
    await a.pedido({ totalCents: 4_000, paidAt: at('2026-10-05T15:00:00.000Z') }) // mesmo trecho do mês passado
    await a.pedido({ totalCents: 6_000, paidAt: at('2026-10-25T15:00:00.000Z') }) // mês passado, fora do trecho
    await a.pedido({ totalCents: 9_999, status: 'AWAITING_PAYMENT', paidAt: null })
    await a.pedido({ totalCents: 8_888, status: 'CANCELED', paidAt: null })
    const desligada = await loja({ store: false })
    await desligada.pedido({ totalCents: 77_000, paidAt: at('2026-11-10T15:00:00.000Z') })
    const arquivada = await loja({ store: true, status: 'ARCHIVED' })
    await arquivada.pedido({ totalCents: 55_000, paidAt: at('2026-11-10T15:00:00.000Z') })

    const o = await getOverview(actor, NOW)

    expect(o.store.accounts).toBe(1)
    expect(o.store.paidOrders).toEqual({ current: 2, previous: 2, previousSamePeriod: 1 })
    expect(o.store.revenueCents).toEqual({ current: 12_500, previous: 10_000, previousSamePeriod: 4_000 })
  })

  test('sem nenhuma conta com Loja ligada: zeros', async () => {
    await loja({ store: false })
    const o = await getOverview(actor, NOW)
    const zero = { current: 0, previous: 0, previousSamePeriod: 0 }
    expect(o.store).toEqual({ accounts: 0, paidOrders: zero, revenueCents: zero })
  })

  test('o mês é o do fuso de cada conta', async () => {
    const mn = await loja({ store: true, timezone: 'America/Manaus' })
    // 01/11 02:00 UTC ainda é 31/10 22:00 em Manaus (mês passado) e 31/10 23:00 em São Paulo.
    await mn.pedido({ totalCents: 1_000, paidAt: at('2026-11-01T02:00:00.000Z') })
    await mn.pedido({ totalCents: 3_000, paidAt: at('2026-11-01T05:00:00.000Z') })
    const o = await getOverview(actor, NOW)
    expect(o.store.paidOrders.current).toBe(1)
    expect(o.store.revenueCents.current).toBe(3_000)
  })
})

describe('volume da loja no getAccountMetrics', () => {
  test('conta com Loja ligada traz pedidos pagos e receita', async () => {
    const a = await loja({ store: true })
    await a.pedido({ totalCents: 10_000, paidAt: at('2026-11-10T15:00:00.000Z') })
    await a.pedido({ totalCents: 4_000, paidAt: at('2026-10-05T15:00:00.000Z') })
    const outra = await loja({ store: true })
    await outra.pedido({ totalCents: 99_000, paidAt: at('2026-11-10T15:00:00.000Z') })

    const m = await getAccountMetrics(actor, a.b.id, NOW)

    expect(m.store).toEqual({
      paidOrders: { current: 1, previous: 1, previousSamePeriod: 1 },
      revenueCents: { current: 10_000, previous: 4_000, previousSamePeriod: 4_000 },
    })
  })

  test('conta sem Loja ligada: store é null, mesmo com pedidos antigos', async () => {
    const a = await loja({ store: false })
    await a.pedido({ totalCents: 10_000, paidAt: at('2026-11-10T15:00:00.000Z') })
    expect((await getAccountMetrics(actor, a.b.id, NOW)).store).toBeNull()
  })
})
