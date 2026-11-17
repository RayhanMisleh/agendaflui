import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { isUniqueViolation } from '@/server/domain/errors'
import { adjustPoints, getBalance, getCustomerLoyalty, listLoyaltyEntries } from '@/server/domain/loyalty/ledger'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCtx, makeCustomer } from '../setup/factories'
import { AGORA, cenaFidelidade, ctxDoCliente, lancar, memberOf, saldoNoBanco } from '../setup/loyalty'

beforeEach(resetDb)

async function falha(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('Era esperado um erro.')
}

describe('saldo', () => {
  test('é a soma das linhas do cliente, e só dele', async () => {
    const s = await cenaFidelidade()
    const outro = await makeCustomer(s.b.id)
    await lancar(s.b.id, s.cliente.id, 100)
    await lancar(s.b.id, s.cliente.id, -30)
    await lancar(s.b.id, outro.id, 500)
    expect(await getBalance(s.dono.db, s.cliente.id)).toBe(70)
    expect(await getBalance(s.dono.db, outro.id)).toBe(500)
  })

  test('sem linhas o saldo é 0, e a conta B não enxerga as linhas da conta A', async () => {
    const s = await cenaFidelidade()
    await lancar(s.b.id, s.cliente.id, 100)
    const b2 = await makeBusiness()
    const ctxB = await makeCtx(b2)
    expect(await getBalance(ctxB.db, s.cliente.id)).toBe(0)
    const novo = await makeCustomer(s.b.id)
    expect(await getBalance(s.dono.db, novo.id)).toBe(0)
  })

  test('getCustomerLoyalty devolve saldo e clube; o cliente vê o próprio, o profissional lê, outro cliente não', async () => {
    const s = await cenaFidelidade()
    await prisma.customer.update({ where: { id: s.cliente.id }, data: { isClubMember: true } })
    await lancar(s.b.id, s.cliente.id, 40)
    expect(await getCustomerLoyalty(s.ctxCliente, s.cliente.id)).toEqual({ balance: 40, clubMember: true })
    expect(await getCustomerLoyalty(s.profissional, s.cliente.id)).toEqual({ balance: 40, clubMember: true })
    const outro = await makeCustomer(s.b.id)
    const ctxOutro = await ctxDoCliente(s.b, outro)
    expect((await domainError(getCustomerLoyalty(ctxOutro, s.cliente.id))).code).toBe('forbidden')
    expect((await domainError(getCustomerLoyalty(s.dono, randomUUID()))).code).toBe('not_found')
  })

  test('com o módulo desligado a leitura é recusada', async () => {
    const s = await cenaFidelidade({ modulo: false })
    expect((await domainError(getCustomerLoyalty(s.dono, s.cliente.id))).code).toBe('module_disabled')
    expect((await domainError(listLoyaltyEntries(s.dono, s.cliente.id))).code).toBe('module_disabled')
  })
})

describe('restrições do banco', () => {
  test('a mesma dedupe_key duas vezes na conta viola a unicidade e deixa uma linha só', async () => {
    const s = await cenaFidelidade()
    await lancar(s.b.id, s.cliente.id, 10, { dedupeKey: 'appt:x:earn:0' })
    const erro = await falha(lancar(s.b.id, s.cliente.id, 10, { dedupeKey: 'appt:x:earn:0' }))
    expect(isUniqueViolation(erro)).toBe(true)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(1)
  })

  test('a mesma dedupe_key em outra conta é aceita', async () => {
    const s = await cenaFidelidade()
    const b2 = await makeBusiness()
    const c2 = await makeCustomer(b2.id)
    await lancar(s.b.id, s.cliente.id, 10, { dedupeKey: 'igual' })
    await lancar(b2.id, c2.id, 10, { dedupeKey: 'igual' })
    expect(await prisma.loyaltyTransaction.count()).toBe(2)
  })

  test('pontos zero, sinal errado para o tipo e ajuste sem motivo são recusados', async () => {
    const s = await cenaFidelidade()
    const base = { businessId: s.b.id, customerId: s.cliente.id, createdByType: 'SYSTEM' as const }
    const novo = (kind: 'EARN' | 'EARN_REVERSAL' | 'REDEEM' | 'REDEEM_REVERSAL' | 'ADJUST', points: number, reason?: string) =>
      prisma.loyaltyTransaction.create({ data: { ...base, kind, points, dedupeKey: randomUUID(), ...(reason === undefined ? {} : { reason }) } })
    await expect(novo('ADJUST', 0, 'motivo')).rejects.toThrow()
    await expect(novo('EARN', -5)).rejects.toThrow()
    await expect(novo('REDEEM_REVERSAL', -5)).rejects.toThrow()
    await expect(novo('EARN_REVERSAL', 5)).rejects.toThrow()
    await expect(novo('REDEEM', 5)).rejects.toThrow()
    await expect(novo('ADJUST', 5)).rejects.toThrow()
    await expect(novo('ADJUST', 5, '   ')).rejects.toThrow()
    await expect(novo('EARN', 5)).resolves.toBeTruthy()
    await expect(novo('EARN_REVERSAL', -5)).resolves.toBeTruthy()
    await expect(novo('REDEEM', -5)).resolves.toBeTruthy()
    await expect(novo('REDEEM_REVERSAL', 5)).resolves.toBeTruthy()
    await expect(novo('ADJUST', -5, 'motivo')).resolves.toBeTruthy()
  })
})

describe('adjustPoints', () => {
  test('o dono credita, grava a linha com o autor e o motivo, e audita com pontos e motivo', async () => {
    const s = await cenaFidelidade()
    const r = await adjustPoints(s.dono, { customerId: s.cliente.id, points: 25, reason: '  Brinde de aniversário  ' })
    expect(r.balance).toBe(25)
    expect(r.entry).toMatchObject({ kind: 'ADJUST', points: 25, reason: 'Brinde de aniversário', appointmentId: null, redemptionId: null })
    expect(typeof r.entry.createdLabel).toBe('string')
    const linha = await prisma.loyaltyTransaction.findUniqueOrThrow({ where: { id: r.entry.id } })
    expect(linha).toMatchObject({ kind: 'ADJUST', points: 25, createdByType: 'MEMBER', createdById: memberOf(s.dono).userId })
    expect(linha.dedupeKey.length).toBeGreaterThan(5)
    const auditoria = await prisma.auditLog.findFirstOrThrow({ where: { businessId: s.b.id, action: 'loyalty.adjusted' } })
    expect(auditoria.metadata).toMatchObject({ customerId: s.cliente.id, points: 25, reason: 'Brinde de aniversário' })
    expect(auditoria.targetId).toBe(s.cliente.id)
  })

  test('o gerente também ajusta, e o débito até zerar é aceito', async () => {
    const s = await cenaFidelidade()
    await lancar(s.b.id, s.cliente.id, 30)
    const r = await adjustPoints(s.gerente, { customerId: s.cliente.id, points: -30, reason: 'Correção de lançamento' })
    expect(r.balance).toBe(0)
    expect(r.entry.points).toBe(-30)
  })

  test('ajuste de −30 com saldo 20 é recusado e nada é gravado', async () => {
    const s = await cenaFidelidade()
    await lancar(s.b.id, s.cliente.id, 20)
    const erro = await domainError(adjustPoints(s.dono, { customerId: s.cliente.id, points: -30, reason: 'Correção' }))
    expect(erro).toMatchObject({ code: 'conflict', reason: 'insufficient_points' })
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(20)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { businessId: s.b.id, action: 'loyalty.adjusted' } })).toBe(0)
  })

  test('com saldo negativo (estorno) só ajuste positivo passa', async () => {
    const s = await cenaFidelidade()
    await lancar(s.b.id, s.cliente.id, -10)
    expect((await domainError(adjustPoints(s.dono, { customerId: s.cliente.id, points: -1, reason: 'Correção' }))).reason).toBe('insufficient_points')
    expect((await adjustPoints(s.dono, { customerId: s.cliente.id, points: 15, reason: 'Correção' })).balance).toBe(5)
  })

  test('validação: sem motivo, motivo curto ou longo, zero, fração e fora da faixa', async () => {
    const s = await cenaFidelidade()
    const tenta = (points: unknown, reason: unknown) =>
      domainError(adjustPoints(s.dono, { customerId: s.cliente.id, points, reason } as never))
    const semMotivo = await tenta(10, undefined)
    expect(semMotivo.code).toBe('validation')
    expect(semMotivo.fields).toHaveProperty('reason')
    expect((await tenta(10, '')).code).toBe('validation')
    expect((await tenta(10, '  ab  ')).code).toBe('validation')
    expect((await tenta(10, 'x'.repeat(201))).fields).toHaveProperty('reason')
    expect((await tenta(0, 'Motivo')).fields).toHaveProperty('points')
    expect((await tenta(1.5, 'Motivo')).fields).toHaveProperty('points')
    expect((await tenta(100_001, 'Motivo')).fields).toHaveProperty('points')
    expect((await tenta(-100_001, 'Motivo')).fields).toHaveProperty('points')
    expect((await adjustPoints(s.dono, { customerId: s.cliente.id, points: 100_000, reason: 'Máximo' })).balance).toBe(100_000)
    expect(await prisma.loyaltyTransaction.count({ where: { businessId: s.b.id } })).toBe(1)
  })

  test('profissional e cliente não ajustam (forbidden)', async () => {
    const s = await cenaFidelidade()
    expect((await domainError(adjustPoints(s.profissional, { customerId: s.cliente.id, points: 5, reason: 'Motivo' }))).code).toBe('forbidden')
    expect((await domainError(adjustPoints(s.ctxCliente, { customerId: s.cliente.id, points: 5, reason: 'Motivo' }))).code).toBe('forbidden')
    expect(await prisma.loyaltyTransaction.count()).toBe(0)
  })

  test('cliente arquivado ou anonimizado não recebe ajuste (customer_inactive)', async () => {
    const s = await cenaFidelidade()
    const arquivado = await makeCustomer(s.b.id, { archivedAt: AGORA })
    const anonimo = await makeCustomer(s.b.id, { archivedAt: AGORA, anonymizedAt: AGORA })
    for (const c of [arquivado, anonimo]) {
      const erro = await domainError(adjustPoints(s.dono, { customerId: c.id, points: 5, reason: 'Motivo' }))
      expect(erro).toMatchObject({ code: 'conflict', reason: 'customer_inactive' })
    }
    expect(await prisma.loyaltyTransaction.count()).toBe(0)
  })

  test('cliente de outra conta é not_found, e o módulo desligado recusa', async () => {
    const s = await cenaFidelidade()
    const b2 = await makeBusiness()
    const alheio = await makeCustomer(b2.id)
    expect((await domainError(adjustPoints(s.dono, { customerId: alheio.id, points: 5, reason: 'Motivo' }))).code).toBe('not_found')
    const off = await cenaFidelidade({ modulo: false })
    expect((await domainError(adjustPoints(off.dono, { customerId: off.cliente.id, points: 5, reason: 'Motivo' }))).code).toBe('module_disabled')
  })
})

describe('listLoyaltyEntries', () => {
  test('mais recente primeiro, paginado por cursor, sem repetir nem pular linhas', async () => {
    const s = await cenaFidelidade()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await lancar(s.b.id, s.cliente.id, i + 1, { createdAt: new Date(AGORA.getTime() - (5 - i) * 3_600_000) })).id)
    const p1 = await listLoyaltyEntries(s.ctxCliente, s.cliente.id, { limit: 2 })
    expect(p1.items.map((e) => e.points)).toEqual([5, 4])
    expect(p1.nextCursor).not.toBeNull()
    const p2 = await listLoyaltyEntries(s.ctxCliente, s.cliente.id, { limit: 2, cursor: p1.nextCursor as string })
    expect(p2.items.map((e) => e.points)).toEqual([3, 2])
    const p3 = await listLoyaltyEntries(s.ctxCliente, s.cliente.id, { limit: 2, cursor: p2.nextCursor as string })
    expect(p3.items.map((e) => e.points)).toEqual([1])
    expect(p3.nextCursor).toBeNull()
    expect([...p1.items, ...p2.items, ...p3.items].map((e) => e.id).sort()).toEqual([...ids].sort())
  })

  test('mesmo instante desempata por id, e o rótulo vem no fuso da conta', async () => {
    const s = await cenaFidelidade()
    for (let i = 0; i < 3; i++) await lancar(s.b.id, s.cliente.id, 1, { createdAt: AGORA })
    const a = await listLoyaltyEntries(s.dono, s.cliente.id, { limit: 2 })
    const b = await listLoyaltyEntries(s.dono, s.cliente.id, { limit: 2, cursor: a.nextCursor as string })
    expect(new Set([...a.items, ...b.items].map((e) => e.id)).size).toBe(3)
    expect(a.items[0]?.createdLabel).toContain('11:00')
  })

  test('cursor inválido e limite fora da faixa são validation', async () => {
    const s = await cenaFidelidade()
    expect((await domainError(listLoyaltyEntries(s.dono, s.cliente.id, { cursor: 'lixo' }))).code).toBe('validation')
    expect((await domainError(listLoyaltyEntries(s.dono, s.cliente.id, { limit: 0 }))).code).toBe('validation')
    expect((await domainError(listLoyaltyEntries(s.dono, s.cliente.id, { limit: 101 }))).code).toBe('validation')
  })

  test('o cliente só lê o próprio extrato; o profissional lê; cliente de outra conta é not_found', async () => {
    const s = await cenaFidelidade()
    await lancar(s.b.id, s.cliente.id, 10)
    const outro = await makeCustomer(s.b.id)
    expect((await listLoyaltyEntries(s.profissional, s.cliente.id)).items).toHaveLength(1)
    expect((await domainError(listLoyaltyEntries(await ctxDoCliente(s.b, outro), s.cliente.id))).code).toBe('forbidden')
    const b2 = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: b2.id }, data: { loyalty: true } })
    expect((await domainError(listLoyaltyEntries(await makeCtx(b2), s.cliente.id))).code).toBe('not_found')
  })
})
