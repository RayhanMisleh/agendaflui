import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { adjustPoints } from '@/server/domain/loyalty/ledger'
import { createPrize } from '@/server/domain/loyalty/prizes'
import { cancelRedemption, redeemPrize } from '@/server/domain/loyalty/redemptions'
import { completeAppointment, undoOutcome } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { agendamentoComPontos, AGORA, cenaFidelidade, lancar } from '../setup/loyalty'

beforeEach(resetDb)

const instantes = async (businessId: string) =>
  (await prisma.loyaltyTransaction.findMany({ where: { businessId, kind: { not: 'ADJUST' } }, orderBy: { createdAt: 'asc' } })).map((r) => [r.kind, r.createdAt.getTime()])

describe('data das linhas do extrato vem do relógio da conta (ctx.clock), não do banco', () => {
  test('crédito e estorno do atendimento', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    await completeAppointment(s.dono, ag.id)
    await undoOutcome(s.dono, ag.id)
    expect(await instantes(s.b.id)).toEqual([
      ['EARN', AGORA.getTime()],
      ['EARN_REVERSAL', AGORA.getTime()],
    ])
  })

  test('resgate, cancelamento do resgate e ajuste manual', async () => {
    const s = await cenaFidelidade()
    await lancar(s.b.id, s.cliente.id, 100, { createdAt: new Date('2026-01-01T00:00:00Z') })
    const prize = await createPrize(s.dono, { name: 'Corte grátis', description: null, costPoints: 40, stock: null, active: true })
    const r = await redeemPrize(s.ctxCliente, { prizeId: prize.id })
    await cancelRedemption(s.dono, r.redemption.id)
    await adjustPoints(s.dono, { customerId: s.cliente.id, points: 5, reason: 'Cortesia' })
    const rows = await prisma.loyaltyTransaction.findMany({ where: { businessId: s.b.id, createdByType: { not: 'SYSTEM' } } })
    expect(rows.map((x) => [x.kind, x.createdAt.getTime()]).sort()).toEqual([
      ['ADJUST', AGORA.getTime()],
      ['REDEEM', AGORA.getTime()],
      ['REDEEM_REVERSAL', AGORA.getTime()],
    ])
  })
})
