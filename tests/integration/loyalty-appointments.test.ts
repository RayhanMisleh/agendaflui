import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { isUniqueViolation } from '@/server/domain/errors'
import { cancelAppointment, completeAppointment, confirmAppointment, markNoShow, undoOutcome } from '@/server/domain/scheduling/appointments'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeCtx } from '../setup/factories'
import { agendamentoComPontos, cenaFidelidade, lancar, memberOf, saldoNoBanco } from '../setup/loyalty'

beforeEach(resetDb)

const linhas = (businessId: string, appointmentId: string) =>
  prisma.loyaltyTransaction.findMany({ where: { businessId, appointmentId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })

describe('crédito na conclusão', () => {
  test('dois serviços de 10 e 15 pontos creditam 25, uma vez, com a chave e o autor', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10, 15])
    await completeAppointment(s.dono, ag.id)
    const rows = await linhas(s.b.id, ag.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'EARN',
      points: 25,
      customerId: s.cliente.id,
      dedupeKey: `appt:${ag.id}:earn:0`,
      createdByType: 'MEMBER',
      createdById: memberOf(s.dono).userId,
    })
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
  })

  test('concluir de novo é recusado e não credita outra vez', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10, 15])
    await completeAppointment(s.dono, ag.id)
    expect((await domainError(completeAppointment(s.dono, ag.id))).reason).toBe('invalid_transition')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
  })

  test('concluir → desfazer → concluir: extrato +25, −25, +25 e saldo 25', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10, 15])
    await completeAppointment(s.dono, ag.id)
    await undoOutcome(s.dono, ag.id)
    await completeAppointment(s.dono, ag.id)
    const rows = await linhas(s.b.id, ag.id)
    expect(rows.map((r) => [r.kind, r.points, r.dedupeKey])).toEqual([
      ['EARN', 25, `appt:${ag.id}:earn:0`],
      ['EARN_REVERSAL', -25, `appt:${ag.id}:reversal:0`],
      ['EARN', 25, `appt:${ag.id}:earn:1`],
    ])
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
  })

  test('concluir e desfazer três vezes mantém a conta: saldo zero e uma linha por evento', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [7])
    for (let i = 0; i < 3; i++) {
      await completeAppointment(s.dono, ag.id)
      await undoOutcome(s.dono, ag.id)
    }
    expect(await linhas(s.b.id, ag.id)).toHaveLength(6)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
  })

  test('serviço com 0 pontos não grava linha', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [0, 0])
    await completeAppointment(s.dono, ag.id)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(0)
    await undoOutcome(s.dono, ag.id)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('usa a cópia dos pontos feita na marcação, não o valor atual do serviço', async () => {
    const s = await cenaFidelidade()
    const { ag, servicos } = await agendamentoComPontos(s.b, s.cliente.id, [10, 15])
    await prisma.service.updateMany({ where: { id: { in: servicos.map((x) => x.id) } }, data: { rewardPoints: 999 } })
    await completeAppointment(s.dono, ag.id)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
  })

  test('inserir à mão a mesma chave de crédito viola a unicidade', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    await completeAppointment(s.dono, ag.id)
    let erro: unknown
    try {
      await lancar(s.b.id, s.cliente.id, 10, { kind: 'EARN', appointmentId: ag.id, dedupeKey: `appt:${ag.id}:earn:0` })
    } catch (e) {
      erro = e
    }
    expect(isUniqueViolation(erro)).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(10)
  })

  test('conclusão recusada (cedo demais ou sem confirmar) não credita nada', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    const antes = await makeCtx(s.b, { now: new Date('2026-11-17T12:00:00Z') })
    expect((await domainError(completeAppointment(antes, ag.id))).reason).toBe('too_early')
    await prisma.appointment.update({ where: { id: ag.id }, data: { status: 'PENDING' } })
    expect((await domainError(completeAppointment(s.dono, ag.id))).reason).toBe('invalid_transition')
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(0)
    await confirmAppointment(s.dono, ag.id)
    await completeAppointment(s.dono, ag.id)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(10)
  })

  test('cancelar um agendamento não mexe em pontos', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    await cancelAppointment(s.dono, ag.id)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(0)
  })
})

describe('desfazer', () => {
  test('desfazer uma falta não grava nada', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    await markNoShow(s.dono, ag.id)
    await undoOutcome(s.dono, ag.id)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('desfazer uma falta de um atendimento que já tinha crédito não estorna', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    await completeAppointment(s.dono, ag.id)
    await undoOutcome(s.dono, ag.id)
    await markNoShow(s.dono, ag.id)
    await undoOutcome(s.dono, ag.id)
    expect((await linhas(s.b.id, ag.id)).map((r) => r.kind)).toEqual(['EARN', 'EARN_REVERSAL'])
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
  })
})

describe('módulo desligado', () => {
  test('concluir com a Fidelidade desligada não credita', async () => {
    const s = await cenaFidelidade({ modulo: false })
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10, 15])
    await completeAppointment(s.dono, ag.id)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('desfazer uma conclusão creditada antes de desligar estorna, mesmo desligada', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10, 15])
    await completeAppointment(s.dono, ag.id)
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: false } })
    await undoOutcome(s.dono, ag.id)
    expect((await linhas(s.b.id, ag.id)).map((r) => [r.kind, r.points])).toEqual([
      ['EARN', 25],
      ['EARN_REVERSAL', -25],
    ])
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
  })

  test('concluído com o módulo desligado e desfeito com ele ligado: sem crédito, sem estorno', async () => {
    const s = await cenaFidelidade({ modulo: false })
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    await completeAppointment(s.dono, ag.id)
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: true } })
    await undoOutcome(s.dono, ag.id)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('religar o módulo e concluir de novo credita uma vez só', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [10])
    await completeAppointment(s.dono, ag.id)
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: false } })
    await undoOutcome(s.dono, ag.id)
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: true } })
    await completeAppointment(s.dono, ag.id)
    expect((await linhas(s.b.id, ag.id)).map((r) => r.dedupeKey)).toEqual([`appt:${ag.id}:earn:0`, `appt:${ag.id}:reversal:0`, `appt:${ag.id}:earn:1`])
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(10)
  })
})
