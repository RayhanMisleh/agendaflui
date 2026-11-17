import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { adjustPoints } from '@/server/domain/loyalty/ledger'
import { createPrize } from '@/server/domain/loyalty/prizes'
import { cancelRedemption, redeemPrize } from '@/server/domain/loyalty/redemptions'
import { completeAppointment, undoOutcome } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { makeCustomer } from '../setup/factories'
import { agendamentoComPontos, cenaFidelidade, ctxDoCliente, lancar, saldoNoBanco } from '../setup/loyalty'

beforeEach(resetDb)

/** Cada teste repete a disputa em várias rodadas: sem a trava ou a chave, ao menos uma rodada quebra. */
const RODADAS = 6

const reasons = (rs: PromiseSettledResult<unknown>[]) =>
  rs.map((r) => (r.status === 'fulfilled' ? 'ok' : ((r.reason as { reason?: string; code?: string }).reason ?? (r.reason as { code?: string }).code ?? 'erro')))

describe('resgates simultâneos', () => {
  test('dois resgates de 100 com saldo 150: um passa, o outro insufficient_points, saldo 50', async () => {
    const s = await cenaFidelidade()
    const prize = await createPrize(s.dono, { name: 'Corte', description: null, costPoints: 100, stock: null, active: true })
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      await lancar(s.b.id, c.id, 150)
      const ctx = await ctxDoCliente(s.b, c)
      const rs = await Promise.allSettled([redeemPrize(ctx, { prizeId: prize.id }), redeemPrize(ctx, { prizeId: prize.id })])
      expect(reasons(rs).sort()).toEqual(['insufficient_points', 'ok'])
      expect(await saldoNoBanco(s.b.id, c.id)).toBe(50)
      expect(await prisma.prizeRedemption.count({ where: { customerId: c.id } })).toBe(1)
      expect(await prisma.loyaltyTransaction.count({ where: { customerId: c.id, kind: 'REDEEM' } })).toBe(1)
    }
  })

  test('estoque 1 e dois clientes ao mesmo tempo: um resgata, o outro out_of_stock', async () => {
    const s = await cenaFidelidade()
    for (let i = 0; i < RODADAS; i++) {
      const prize = await createPrize(s.dono, { name: `Raro ${i}`, description: null, costPoints: 10, stock: 1, active: true })
      const [a, b] = [await makeCustomer(s.b.id), await makeCustomer(s.b.id)]
      await lancar(s.b.id, a.id, 10)
      await lancar(s.b.id, b.id, 10)
      const rs = await Promise.allSettled([redeemPrize(await ctxDoCliente(s.b, a), { prizeId: prize.id }), redeemPrize(await ctxDoCliente(s.b, b), { prizeId: prize.id })])
      expect(reasons(rs).sort()).toEqual(['ok', 'out_of_stock'])
      expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(0)
      expect((await saldoNoBanco(s.b.id, a.id)) + (await saldoNoBanco(s.b.id, b.id))).toBe(10)
      expect(await prisma.prizeRedemption.count({ where: { prizeId: prize.id } })).toBe(1)
    }
  })

  test('a mesma Idempotency-Key três vezes ao mesmo tempo gera um resgate só', async () => {
    const s = await cenaFidelidade()
    const prize = await createPrize(s.dono, { name: 'Corte', description: null, costPoints: 100, stock: 10, active: true })
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      await lancar(s.b.id, c.id, 1000)
      const ctx = await ctxDoCliente(s.b, c)
      const rs = await Promise.all([1, 2, 3].map(() => redeemPrize(ctx, { prizeId: prize.id, idempotencyKey: `k-${i}` })))
      expect(new Set(rs.map((r) => r.redemption.id)).size).toBe(1)
      expect(rs.filter((r) => r.replayed)).toHaveLength(2)
      expect(await saldoNoBanco(s.b.id, c.id)).toBe(900)
      expect(await prisma.loyaltyTransaction.count({ where: { customerId: c.id, kind: 'REDEEM' } })).toBe(1)
    }
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(10 - RODADAS)
  })
})

describe('cancelamentos simultâneos', () => {
  test('três cancelamentos: um vale, os outros invalid_transition; um estorno e o estoque volta uma vez', async () => {
    const s = await cenaFidelidade()
    const prize = await createPrize(s.dono, { name: 'Corte', description: null, costPoints: 100, stock: 5, active: true })
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      await lancar(s.b.id, c.id, 100)
      const ctx = await ctxDoCliente(s.b, c)
      const r = await redeemPrize(ctx, { prizeId: prize.id })
      const rs = await Promise.allSettled([cancelRedemption(ctx, r.redemption.id), cancelRedemption(s.dono, r.redemption.id), cancelRedemption(ctx, r.redemption.id)])
      expect(reasons(rs).sort()).toEqual(['invalid_transition', 'invalid_transition', 'ok'])
      expect(await saldoNoBanco(s.b.id, c.id)).toBe(100)
      expect(await prisma.loyaltyTransaction.count({ where: { customerId: c.id, kind: 'REDEEM_REVERSAL' } })).toBe(1)
    }
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(5)
  })

  test('cancelar e resgatar de novo ao mesmo tempo nunca deixa o saldo negativo', async () => {
    const s = await cenaFidelidade()
    const prize = await createPrize(s.dono, { name: 'Corte', description: null, costPoints: 100, stock: null, active: true })
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      await lancar(s.b.id, c.id, 100)
      const ctx = await ctxDoCliente(s.b, c)
      const r = await redeemPrize(ctx, { prizeId: prize.id })
      await Promise.allSettled([cancelRedemption(ctx, r.redemption.id), redeemPrize(ctx, { prizeId: prize.id }), redeemPrize(ctx, { prizeId: prize.id })])
      expect(await saldoNoBanco(s.b.id, c.id)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('ajustes simultâneos', () => {
  test('dois ajustes de −30 com saldo 50: um passa, o outro insufficient_points', async () => {
    const s = await cenaFidelidade()
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      await lancar(s.b.id, c.id, 50)
      const rs = await Promise.allSettled([
        adjustPoints(s.dono, { customerId: c.id, points: -30, reason: 'Correção A' }),
        adjustPoints(s.gerente, { customerId: c.id, points: -30, reason: 'Correção B' }),
      ])
      expect(reasons(rs).sort()).toEqual(['insufficient_points', 'ok'])
      expect(await saldoNoBanco(s.b.id, c.id)).toBe(20)
    }
  })
})

describe('conclusão e desfazer simultâneos', () => {
  test('duas conclusões ao mesmo tempo creditam uma vez', async () => {
    const s = await cenaFidelidade()
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      const { ag } = await agendamentoComPontos(s.b, c.id, [10, 15])
      const rs = await Promise.allSettled([completeAppointment(s.dono, ag.id), completeAppointment(s.gerente, ag.id)])
      expect(reasons(rs).sort()).toEqual(['invalid_transition', 'ok'])
      expect(await saldoNoBanco(s.b.id, c.id)).toBe(25)
      expect(await prisma.loyaltyTransaction.count({ where: { appointmentId: ag.id } })).toBe(1)
    }
  })

  test('dois desfazer ao mesmo tempo estornam uma vez', async () => {
    const s = await cenaFidelidade()
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      const { ag } = await agendamentoComPontos(s.b, c.id, [10, 15])
      await completeAppointment(s.dono, ag.id)
      const rs = await Promise.allSettled([undoOutcome(s.dono, ag.id), undoOutcome(s.gerente, ag.id)])
      expect(reasons(rs).sort()).toEqual(['invalid_transition', 'ok'])
      expect(await saldoNoBanco(s.b.id, c.id)).toBe(0)
      expect(await prisma.loyaltyTransaction.count({ where: { appointmentId: ag.id, kind: 'EARN_REVERSAL' } })).toBe(1)
    }
  })

  test('resgate e desfazer da conclusão ao mesmo tempo: o saldo sempre fecha com as linhas', async () => {
    const s = await cenaFidelidade()
    const prize = await createPrize(s.dono, { name: 'Corte', description: null, costPoints: 100, stock: null, active: true })
    for (let i = 0; i < RODADAS; i++) {
      const c = await makeCustomer(s.b.id)
      const { ag } = await agendamentoComPontos(s.b, c.id, [100])
      await completeAppointment(s.dono, ag.id)
      const [resgate, desfazer] = await Promise.allSettled([redeemPrize(await ctxDoCliente(s.b, c), { prizeId: prize.id }), undoOutcome(s.dono, ag.id)])
      expect(desfazer.status).toBe('fulfilled')
      // Estornou primeiro: o resgate falha e o saldo é 0. Resgatou primeiro: o estorno deixa −100.
      expect(await saldoNoBanco(s.b.id, c.id)).toBe(resgate.status === 'fulfilled' ? -100 : 0)
    }
  })
})
