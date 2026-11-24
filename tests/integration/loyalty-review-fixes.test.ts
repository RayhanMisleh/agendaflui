import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { isUniqueViolation } from '@/server/domain/errors'
import { adjustPoints, listLoyaltyEntries } from '@/server/domain/loyalty/ledger'
import { applyAppointmentLoyalty } from '@/server/domain/loyalty/appointment-points'
import { createPrize, updatePrize } from '@/server/domain/loyalty/prizes'
import { cancelRedemption, redeemPrize } from '@/server/domain/loyalty/redemptions'
import { completeAppointment, undoOutcome } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { agendamentoComPontos, cenaFidelidade, lancar, saldoNoBanco } from '../setup/loyalty'

beforeEach(resetDb)

const premio = (s: Awaited<ReturnType<typeof cenaFidelidade>>, o: { costPoints?: number; stock?: number | null } = {}) =>
  createPrize(s.dono, { name: 'Corte', description: null, costPoints: o.costPoints ?? 100, stock: o.stock === undefined ? null : o.stock, active: true })

describe('crédito por conclusão idempotente no banco', () => {
  test('o mesmo evento de conclusão entregue duas vezes credita uma vez só', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10, 15])
    await completeAppointment(s.dono, ag.id)
    const linha = await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id }, include: { items: true, customer: true, professional: true, pet: true } })
    const repetido = await s.dono.db.$transaction((tx) => applyAppointmentLoyalty(tx, s.dono, 'completed', linha, {})).catch((e: unknown) => e)
    expect(isUniqueViolation(repetido)).toBe(true)
    expect(await prisma.loyaltyTransaction.count({ where: { appointmentId: ag.id, kind: 'EARN' } })).toBe(1)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
  })

  test('concluir, desfazer e concluir termina com um crédito líquido, e a chave liga à conclusão', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [25])
    await completeAppointment(s.dono, ag.id)
    await undoOutcome(s.dono, ag.id)
    await completeAppointment(s.dono, ag.id)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
    const chaves = (await prisma.loyaltyTransaction.findMany({ where: { appointmentId: ag.id, kind: 'EARN' }, orderBy: { createdAt: 'asc' } })).map((r) => r.dedupeKey)
    expect(chaves).toEqual([`appt:${ag.id}:earn:0`, `appt:${ag.id}:earn:1`])
    const linha = await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id }, include: { items: true, customer: true, professional: true, pet: true } })
    const repetido = await s.dono.db.$transaction((tx) => applyAppointmentLoyalty(tx, s.dono, 'completed', linha, {})).catch((e: unknown) => e)
    expect(isUniqueViolation(repetido)).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
  })
})

describe('ajuste manual idempotente', () => {
  const REQ = '3f2b8c1e-7a44-4d0a-9b6e-1c2d3e4f5a6b'

  test('reenviar o mesmo requestId não credita de novo e devolve o ajuste original', async () => {
    const s = await cenaFidelidade()
    const a = await adjustPoints(s.dono, { customerId: s.cliente.id, points: 40, reason: 'Brinde', requestId: REQ })
    const b = await adjustPoints(s.dono, { customerId: s.cliente.id, points: 40, reason: 'Brinde', requestId: REQ })
    expect(b.entry.id).toBe(a.entry.id)
    expect(b.balance).toBe(40)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(40)
    expect((await prisma.loyaltyTransaction.findFirstOrThrow({ where: { customerId: s.cliente.id } })).dedupeKey).toBe(`adjust:${REQ}`)
  })

  test('reenvios simultâneos creditam uma vez', async () => {
    const s = await cenaFidelidade()
    await Promise.all(Array.from({ length: 4 }, () => adjustPoints(s.dono, { customerId: s.cliente.id, points: 10, reason: 'Brinde', requestId: REQ })))
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(10)
  })

  test('o mesmo requestId em outro cliente ou com outro valor é recusado; id que não é UUID é validação', async () => {
    const s = await cenaFidelidade()
    await adjustPoints(s.dono, { customerId: s.cliente.id, points: 40, reason: 'Brinde', requestId: REQ })
    expect((await domainError(adjustPoints(s.dono, { customerId: s.cliente.id, points: 99, reason: 'Brinde', requestId: REQ }))).code).toBe('conflict')
    expect((await domainError(adjustPoints(s.dono, { customerId: s.cliente.id, points: 5, reason: 'Brinde', requestId: 'x' }))).code).toBe('validation')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(40)
  })
})

describe('estoque do prêmio não é sobrescrito às cegas', () => {
  test('o estoque lido ainda vale: grava; mudou no meio: conflito e nada muda', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { stock: 5 })
    await lancar(s.b.id, s.cliente.id, 500)
    await redeemPrize(s.dono, { prizeId: p.id, customerId: s.cliente.id })
    const erro = await domainError(updatePrize(s.dono, p.id, { name: 'Corte novo', stock: 5, expectedStock: 5 }))
    expect(erro.code).toBe('conflict')
    expect(erro.message).toBe('O estoque mudou agora. Recarregue para ver.')
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4)
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })).name).toBe('Corte')
    expect((await updatePrize(s.dono, p.id, { stock: 9, expectedStock: 4 })).stock).toBe(9)
  })

  test('de ilimitado para N também confere o que foi lido (nulo)', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { stock: null })
    expect((await updatePrize(s.dono, p.id, { stock: 3, expectedStock: null })).stock).toBe(3)
    expect((await domainError(updatePrize(s.dono, p.id, { stock: 8, expectedStock: null }))).code).toBe('conflict')
  })

  test('sem expectedStock a atualização segue como antes', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { stock: 5 })
    expect((await updatePrize(s.dono, p.id, { stock: 2 })).stock).toBe(2)
  })
})

describe('cancelar resgate e o estoque', () => {
  test('prêmio que era ilimitado quando foi resgatado não ganha unidade ao cancelar', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { stock: null })
    await lancar(s.b.id, s.cliente.id, 500)
    const { redemption } = await redeemPrize(s.dono, { prizeId: p.id, customerId: s.cliente.id })
    await updatePrize(s.dono, p.id, { stock: 10 })
    await cancelRedemption(s.dono, redemption.id, {})
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(500)
  })

  test('prêmio com estoque limitado recebe a unidade de volta', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { stock: 5 })
    await lancar(s.b.id, s.cliente.id, 500)
    const { redemption } = await redeemPrize(s.dono, { prizeId: p.id, customerId: s.cliente.id })
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4)
    await cancelRedemption(s.dono, redemption.id, {})
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5)
  })

  test('prêmio limitado que virou ilimitado depois do resgate não ganha nada ao cancelar', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { stock: 5 })
    await lancar(s.b.id, s.cliente.id, 500)
    const { redemption } = await redeemPrize(s.dono, { prizeId: p.id, customerId: s.cliente.id })
    await updatePrize(s.dono, p.id, { stock: null })
    await cancelRedemption(s.dono, redemption.id, {})
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })).stock).toBeNull()
  })
})

describe('custo esperado no resgate', () => {
  test('custo atual diferente do que o cliente viu: conflito `changed`, sem débito', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { costPoints: 100 })
    await lancar(s.b.id, s.cliente.id, 1000)
    await updatePrize(s.dono, p.id, { costPoints: 500 })
    const erro = await domainError(redeemPrize(s.ctxCliente, { prizeId: p.id, expectedCostPoints: 100 }))
    expect(erro.code).toBe('conflict')
    expect(erro.reason).toBe('changed')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(1000)
    expect(await prisma.prizeRedemption.count()).toBe(0)
    const { redemption } = await redeemPrize(s.ctxCliente, { prizeId: p.id, expectedCostPoints: 500 })
    expect(redemption.costPoints).toBe(500)
  })

  test('sem expectedCostPoints o resgate segue como antes', async () => {
    const s = await cenaFidelidade()
    const p = await premio(s, { costPoints: 100 })
    await lancar(s.b.id, s.cliente.id, 1000)
    expect((await redeemPrize(s.ctxCliente, { prizeId: p.id })).balance).toBe(900)
  })
})

describe('extrato: o motivo interno do ajuste', () => {
  test('o cliente vê só "Ajuste"; a equipe vê o motivo', async () => {
    const s = await cenaFidelidade()
    await adjustPoints(s.dono, { customerId: s.cliente.id, points: 30, reason: 'Compensação por atraso do João' })
    const doCliente = (await listLoyaltyEntries(s.ctxCliente, s.cliente.id)).items[0]
    expect(doCliente).toMatchObject({ kind: 'ADJUST', points: 30, reason: 'Ajuste' })
    expect(JSON.stringify(doCliente)).not.toContain('João')
    const daEquipe = (await listLoyaltyEntries(s.dono, s.cliente.id)).items[0]
    expect(daEquipe?.reason).toBe('Compensação por atraso do João')
  })
})
