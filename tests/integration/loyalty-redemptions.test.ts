import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { adjustPoints } from '@/server/domain/loyalty/ledger'
import { createPrize, archivePrize } from '@/server/domain/loyalty/prizes'
import { cancelRedemption, deliverRedemption, listRedemptions, redeemPrize } from '@/server/domain/loyalty/redemptions'
import { completeAppointment, undoOutcome } from '@/server/domain/scheduling/appointments'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCtx, makeCustomer } from '../setup/factories'
import { agendamentoComPontos, AGORA, cenaFidelidade, ctxDoCliente, lancar, memberOf, saldoNoBanco } from '../setup/loyalty'

beforeEach(resetDb)

async function cena(saldo = 100, premio: { costPoints?: number; stock?: number | null; name?: string } = {}) {
  const s = await cenaFidelidade()
  if (saldo !== 0) await lancar(s.b.id, s.cliente.id, saldo)
  const prize = await createPrize(s.dono, {
    name: premio.name ?? 'Corte grátis',
    description: null,
    costPoints: premio.costPoints ?? 100,
    stock: premio.stock === undefined ? null : premio.stock,
    active: true,
  })
  return { ...s, prize }
}

const estoqueDe = async (id: string) => (await prisma.prize.findUniqueOrThrow({ where: { id } })).stock

describe('resgate pelo cliente', () => {
  test('com saldo exato zera o saldo, nasce pendente e grava a cópia, o débito e o estoque', async () => {
    const s = await cena(100, { stock: 3 })
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    expect(r.replayed).toBe(false)
    expect(r.balance).toBe(0)
    expect(r.redemption).toMatchObject({
      status: 'PENDING',
      prize: { id: s.prize.id, name: 'Corte grátis' },
      costPoints: 100,
      customer: { id: s.cliente.id, name: 'Maria da Silva' },
      deliveredLabel: null,
      canceledLabel: null,
      cancelReason: null,
    })
    expect(typeof r.redemption.createdLabel).toBe('string')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
    const linha = await prisma.loyaltyTransaction.findFirstOrThrow({ where: { businessId: s.b.id, kind: 'REDEEM' } })
    expect(linha).toMatchObject({ points: -100, redemptionId: r.redemption.id, dedupeKey: `redemption:${r.redemption.id}`, createdByType: 'CUSTOMER', createdById: s.cliente.id })
    const gravado = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.redemption.id } })
    expect(gravado).toMatchObject({ prizeName: 'Corte grátis', costPoints: 100, requestedByType: 'CUSTOMER', requestedById: s.cliente.id, deliveredAt: null })
    expect(await estoqueDe(s.prize.id)).toBe(2)
  })

  test('o resgate guarda o nome e o custo da época, mesmo se o prêmio mudar depois', async () => {
    const s = await cena(100)
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    await prisma.prize.update({ where: { id: s.prize.id }, data: { name: 'Outro nome', costPoints: 999 } })
    const lista = await listRedemptions(s.ctxCliente)
    expect(lista.items[0]).toMatchObject({ id: r.redemption.id, prize: { name: 'Corte grátis' }, costPoints: 100 })
  })

  test('sem estoque controlado (nulo) não baixa nada', async () => {
    const s = await cena(100, { stock: null })
    await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    expect(await estoqueDe(s.prize.id)).toBeNull()
  })

  test('com saldo menor: insufficient_points com a falta nos termos da conta, e nada é gravado', async () => {
    const s = await cena(40, { stock: 5 })
    const erro = await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id }))
    expect(erro).toMatchObject({ code: 'conflict', reason: 'insufficient_points' })
    expect(erro.message).toContain('Faltam 60 Pontos')
    await prisma.businessSettings.update({ where: { businessId: s.b.id }, data: { termPointsPlural: 'moedas' } })
    expect((await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id }))).message).toContain('Faltam 60 moedas')
    expect(await prisma.prizeRedemption.count({ where: { businessId: s.b.id } })).toBe(0)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(40)
    expect(await estoqueDe(s.prize.id)).toBe(5)
  })

  test('saldo negativo bloqueia o resgate, e a falta conta a partir do negativo', async () => {
    const s = await cena(-20)
    const erro = await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id }))
    expect(erro.reason).toBe('insufficient_points')
    expect(erro.message).toContain('Faltam 120')
  })

  test('estoque zero: out_of_stock, sem débito', async () => {
    const s = await cena(100, { stock: 0 })
    const erro = await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id }))
    expect(erro).toMatchObject({ code: 'conflict', reason: 'out_of_stock' })
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
    expect(await prisma.prizeRedemption.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('prêmio inativo, arquivado ou de outra conta é not_found', async () => {
    const s = await cena(1000)
    const inativo = await createPrize(s.dono, { name: 'Parado', description: null, costPoints: 10, stock: null, active: false })
    const velho = await createPrize(s.dono, { name: 'Velho', description: null, costPoints: 10, stock: null, active: true })
    await archivePrize(s.dono, velho.id)
    for (const id of [inativo.id, velho.id]) expect((await domainError(redeemPrize(s.ctxCliente, { prizeId: id }))).code).toBe('not_found')
    const b2 = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: b2.id }, data: { loyalty: true } })
    const c2 = await makeCustomer(b2.id)
    await lancar(b2.id, c2.id, 1000)
    const ctxB = await ctxDoCliente(b2, c2)
    const erro = await domainError(redeemPrize(ctxB, { prizeId: s.prize.id }))
    expect(erro.code).toBe('not_found')
    expect(await saldoNoBanco(b2.id, c2.id)).toBe(1000)
    expect((await domainError(redeemPrize(s.ctxCliente, { prizeId: 'nao-e-uuid' }))).code).toBe('not_found')
  })

  test('cliente arquivado ou anonimizado não resgata (customer_inactive)', async () => {
    const s = await cena(1000)
    for (const dados of [{ archivedAt: AGORA }, { archivedAt: AGORA, anonymizedAt: AGORA }]) {
      await prisma.customer.update({ where: { id: s.cliente.id }, data: dados })
      expect(await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id }))).toMatchObject({ code: 'conflict', reason: 'customer_inactive' })
    }
    expect(await prisma.prizeRedemption.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('o cliente não escolhe outro cliente nem entrega na hora', async () => {
    const s = await cena(1000)
    const outro = await makeCustomer(s.b.id)
    expect((await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id, customerId: outro.id }))).code).toBe('forbidden')
    expect((await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id, deliverNow: true }))).code).toBe('forbidden')
    expect((await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, customerId: s.cliente.id })).redemption.customer.id).toBe(s.cliente.id)
  })

  test('com o módulo desligado todas as operações recusam', async () => {
    const s = await cena(1000)
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: false } })
    const codes = await Promise.all(
      [
        redeemPrize(s.ctxCliente, { prizeId: s.prize.id }),
        listRedemptions(s.ctxCliente),
        deliverRedemption(s.dono, r.redemption.id),
        cancelRedemption(s.ctxCliente, r.redemption.id),
        adjustPoints(s.dono, { customerId: s.cliente.id, points: 5, reason: 'Motivo' }),
      ].map((p) => domainError(p).then((e) => e.code)),
    )
    expect(codes).toEqual(Array(5).fill('module_disabled'))
  })
})

describe('resgate pela equipe', () => {
  test('o dono resgata pelo cliente, com customerId obrigatório, e pode entregar na hora', async () => {
    const s = await cena(100, { stock: 2 })
    expect((await domainError(redeemPrize(s.dono, { prizeId: s.prize.id }))).fields).toHaveProperty('customerId')
    const r = await redeemPrize(s.dono, { prizeId: s.prize.id, customerId: s.cliente.id, deliverNow: true })
    expect(r.redemption.status).toBe('DELIVERED')
    expect(r.redemption.deliveredLabel).toContain('11:00')
    expect(r.balance).toBe(0)
    const gravado = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.redemption.id } })
    expect(gravado).toMatchObject({ status: 'DELIVERED', requestedByType: 'MEMBER', requestedById: memberOf(s.dono).userId })
    expect(gravado.deliveredAt?.getTime()).toBe(AGORA.getTime())
    const linha = await prisma.loyaltyTransaction.findFirstOrThrow({ where: { businessId: s.b.id, kind: 'REDEEM' } })
    expect(linha).toMatchObject({ createdByType: 'MEMBER', createdById: memberOf(s.dono).userId })
  })

  test('o gerente resgata sem entregar: pendente', async () => {
    const s = await cena(100)
    expect((await redeemPrize(s.gerente, { prizeId: s.prize.id, customerId: s.cliente.id })).redemption.status).toBe('PENDING')
  })

  test('profissional não resgata (forbidden)', async () => {
    const s = await cena(100)
    expect((await domainError(redeemPrize(s.profissional, { prizeId: s.prize.id, customerId: s.cliente.id }))).code).toBe('forbidden')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
  })

  test('cliente de outra conta indicado pela equipe é not_found', async () => {
    const s = await cena(100)
    const b2 = await makeBusiness()
    const alheio = await makeCustomer(b2.id)
    expect((await domainError(redeemPrize(s.dono, { prizeId: s.prize.id, customerId: alheio.id }))).code).toBe('not_found')
  })
})

describe('idempotência do resgate', () => {
  test('a mesma chave com o mesmo pedido devolve o original (replayed), sem novo débito, resgate ou baixa de estoque', async () => {
    const s = await cena(300, { stock: 5 })
    const a = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: 'chave-1' })
    const b = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: 'chave-1' })
    expect(a.replayed).toBe(false)
    expect(b.replayed).toBe(true)
    expect(b.redemption.id).toBe(a.redemption.id)
    expect(b.balance).toBe(200)
    expect(await prisma.prizeRedemption.count({ where: { businessId: s.b.id } })).toBe(1)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id, kind: 'REDEEM' } })).toBe(1)
    expect(await estoqueDe(s.prize.id)).toBe(4)
  })

  test('a repetição responde mesmo que o saldo já não cubra o pedido', async () => {
    const s = await cena(100)
    const a = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: 'chave-2' })
    const b = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: 'chave-2' })
    expect(b).toMatchObject({ replayed: true, balance: 0 })
    expect(b.redemption.id).toBe(a.redemption.id)
  })

  test('a mesma chave com outro prêmio é idempotency_key_reused, e nada é gravado', async () => {
    const s = await cena(300)
    const outro = await createPrize(s.dono, { name: 'Outro', description: null, costPoints: 10, stock: null, active: true })
    await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: 'chave-3' })
    const erro = await domainError(redeemPrize(s.ctxCliente, { prizeId: outro.id, idempotencyKey: 'chave-3' }))
    expect(erro).toMatchObject({ code: 'conflict', reason: 'idempotency_key_reused' })
    expect(await prisma.prizeRedemption.count({ where: { businessId: s.b.id } })).toBe(1)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(200)
  })

  test('a chave vale por cliente: outro cliente usa a mesma chave sem conflito', async () => {
    const s = await cena(100)
    const outro = await makeCustomer(s.b.id)
    await lancar(s.b.id, outro.id, 100)
    await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: 'mesma' })
    const r = await redeemPrize(await ctxDoCliente(s.b, outro), { prizeId: s.prize.id, idempotencyKey: 'mesma' })
    expect(r.replayed).toBe(false)
    expect(await prisma.prizeRedemption.count({ where: { businessId: s.b.id } })).toBe(2)
  })

  test('depois de 24 h a chave é liberada e o pedido vale como novo', async () => {
    const s = await cena(300)
    const a = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: 'velha' })
    const depois = await makeCtx(s.b, { actor: { kind: 'customer', customerId: s.cliente.id, name: s.cliente.name }, now: addMinutes(AGORA, 24 * 60 + 1) })
    const b = await redeemPrize(depois, { prizeId: s.prize.id, idempotencyKey: 'velha' })
    expect(b.replayed).toBe(false)
    expect(b.redemption.id).not.toBe(a.redemption.id)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
  })

  test('chave com formato inválido é validation', async () => {
    const s = await cena(100)
    for (const chave of ['', 'tem espaço', 'x'.repeat(81)]) {
      expect((await domainError(redeemPrize(s.ctxCliente, { prizeId: s.prize.id, idempotencyKey: chave }))).code).toBe('validation')
    }
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
  })
})

describe('entregar', () => {
  test('pendente vira entregue; entregar de novo ou cancelado é invalid_transition', async () => {
    const s = await cena(200)
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    const entregue = await deliverRedemption(s.gerente, r.redemption.id)
    expect(entregue.status).toBe('DELIVERED')
    expect(entregue.deliveredLabel).toContain('11:00')
    expect((await domainError(deliverRedemption(s.dono, r.redemption.id))).reason).toBe('invalid_transition')
    const r2 = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    await cancelRedemption(s.dono, r2.redemption.id)
    expect((await domainError(deliverRedemption(s.dono, r2.redemption.id))).reason).toBe('invalid_transition')
  })

  test('cliente e profissional não entregam; id desconhecido é not_found', async () => {
    const s = await cena(100)
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    expect((await domainError(deliverRedemption(s.ctxCliente, r.redemption.id))).code).toBe('forbidden')
    expect((await domainError(deliverRedemption(s.profissional, r.redemption.id))).code).toBe('forbidden')
    expect((await domainError(deliverRedemption(s.dono, '0b8e2f47-3d19-4a5c-8e60-71c2d9a4f3b8'))).code).toBe('not_found')
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.redemption.id } })).status).toBe('PENDING')
  })
})

describe('cancelar', () => {
  test('o cliente cancela o próprio: devolve os pontos e o estoque, e cancelar de novo é invalid_transition', async () => {
    const s = await cena(100, { stock: 3 })
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    const c = await cancelRedemption(s.ctxCliente, r.redemption.id)
    expect(c.status).toBe('CANCELED')
    expect(c.canceledLabel).toContain('11:00')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
    expect(await estoqueDe(s.prize.id)).toBe(3)
    const linha = await prisma.loyaltyTransaction.findFirstOrThrow({ where: { businessId: s.b.id, kind: 'REDEEM_REVERSAL' } })
    expect(linha).toMatchObject({ points: 100, redemptionId: r.redemption.id, dedupeKey: `redemption:${r.redemption.id}:reversal` })
    expect((await domainError(cancelRedemption(s.ctxCliente, r.redemption.id))).reason).toBe('invalid_transition')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
    expect(await estoqueDe(s.prize.id)).toBe(3)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id, kind: 'REDEEM_REVERSAL' } })).toBe(1)
  })

  test('a equipe cancela qualquer resgate pendente, com motivo aparado', async () => {
    const s = await cena(100)
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    const c = await cancelRedemption(s.gerente, r.redemption.id, { reason: '  Prêmio acabou  ' })
    expect(c).toMatchObject({ status: 'CANCELED', cancelReason: 'Prêmio acabou' })
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
  })

  test('resgate entregue não cancela; profissional não cancela; cliente não cancela o de outro (not_found)', async () => {
    const s = await cena(300)
    const outro = await makeCustomer(s.b.id)
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    const d = await redeemPrize(s.dono, { prizeId: s.prize.id, customerId: s.cliente.id, deliverNow: true })
    expect((await domainError(cancelRedemption(s.dono, d.redemption.id))).reason).toBe('invalid_transition')
    expect((await domainError(cancelRedemption(s.profissional, r.redemption.id))).code).toBe('forbidden')
    expect((await domainError(cancelRedemption(await ctxDoCliente(s.b, outro), r.redemption.id))).code).toBe('not_found')
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
  })

  test('devolve o estoque também de prêmio já arquivado, e não toca no que não tem controle', async () => {
    const s = await cena(200, { stock: 1 })
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    await archivePrize(s.dono, s.prize.id)
    await cancelRedemption(s.ctxCliente, r.redemption.id)
    expect(await estoqueDe(s.prize.id)).toBe(1)
    const livre = await createPrize(s.dono, { name: 'Livre', description: null, costPoints: 10, stock: null, active: true })
    const r2 = await redeemPrize(s.ctxCliente, { prizeId: livre.id })
    await cancelRedemption(s.ctxCliente, r2.redemption.id)
    expect(await estoqueDe(livre.id)).toBeNull()
  })

  test('motivo longo demais é validation', async () => {
    const s = await cena(100)
    const r = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    expect((await domainError(cancelRedemption(s.dono, r.redemption.id, { reason: 'x'.repeat(301) }))).code).toBe('validation')
  })
})

describe('listRedemptions', () => {
  test('o cliente vê só os próprios; a equipe vê todos, filtra por situação e por cliente e pagina', async () => {
    const s = await cena(1000)
    const outro = await makeCustomer(s.b.id)
    await lancar(s.b.id, outro.id, 1000)
    const ctxOutro = await ctxDoCliente(s.b, outro)
    const a = await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    await redeemPrize(ctxOutro, { prizeId: s.prize.id })
    await cancelRedemption(s.dono, a.redemption.id)
    expect((await listRedemptions(s.ctxCliente)).items).toHaveLength(2)
    expect((await listRedemptions(ctxOutro)).items).toHaveLength(1)
    expect((await listRedemptions(s.ctxCliente, { customerId: outro.id })).items.every((i) => i.customer.id === s.cliente.id)).toBe(true)
    expect((await listRedemptions(s.dono)).items).toHaveLength(3)
    expect((await listRedemptions(s.dono, { status: 'CANCELED' })).items.map((i) => i.id)).toEqual([a.redemption.id])
    expect((await listRedemptions(s.dono, { customerId: outro.id })).items).toHaveLength(1)
    const p1 = await listRedemptions(s.dono, { limit: 2 })
    expect(p1.items).toHaveLength(2)
    const p2 = await listRedemptions(s.dono, { limit: 2, cursor: p1.nextCursor as string })
    expect(p2.items).toHaveLength(1)
    expect(p2.nextCursor).toBeNull()
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(3)
    expect((await domainError(listRedemptions(s.profissional))).code).toBe('forbidden')
  })

  test('a conta B não vê resgates da conta A', async () => {
    const s = await cena(100)
    await redeemPrize(s.ctxCliente, { prizeId: s.prize.id })
    const b2 = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: b2.id }, data: { loyalty: true } })
    expect((await listRedemptions(await makeCtx(b2))).items).toEqual([])
  })
})

describe('estorno de pontos depois do resgate', () => {
  test('desfazer a conclusão com os pontos já gastos deixa o saldo negativo e bloqueia novo resgate', async () => {
    const s = await cenaFidelidade()
    const { ag } = await agendamentoComPontos(s.b, s.cliente.id, [100])
    await completeAppointment(s.dono, ag.id)
    const prize = await createPrize(s.dono, { name: 'Corte grátis', description: null, costPoints: 100, stock: null, active: true })
    await redeemPrize(s.ctxCliente, { prizeId: prize.id })
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
    await undoOutcome(s.dono, ag.id)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(-100)
    const erro = await domainError(redeemPrize(s.ctxCliente, { prizeId: prize.id }))
    expect(erro.reason).toBe('insufficient_points')
    expect(erro.message).toContain('Faltam 200')
  })
})
