import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import { createClosure, deleteClosure, isClosedOn, listClosures } from '@/server/domain/settings/closures'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeMembership, makeUser } from '../setup/factories'

beforeEach(resetDb)

async function erroDe(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError)
    return e as DomainError
  }
  throw new Error('Era esperado um erro, mas a chamada terminou sem erro.')
}

async function ctxComPapel(business: { id: string }, role: 'MANAGER' | 'PROFESSIONAL') {
  const user = await makeUser()
  const m = await makeMembership(business.id, user.id, role)
  return makeCtx(business, {
    actor: { kind: 'member', userId: user.id, membershipId: m.id, name: user.name, role },
  })
}

describe('createClosure e isClosedOn', () => {
  test('fechado no primeiro e no último dia, aberto antes e depois', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const f = await createClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-26', reason: '  Natal  ' })
    expect(f).toEqual({ id: f.id, startDate: '2026-12-24', endDate: '2026-12-26', reason: 'Natal' })
    expect(await isClosedOn(ctx, '2026-12-23')).toBe(false)
    expect(await isClosedOn(ctx, '2026-12-24')).toBe(true)
    expect(await isClosedOn(ctx, '2026-12-25')).toBe(true)
    expect(await isClosedOn(ctx, '2026-12-26')).toBe(true)
    expect(await isClosedOn(ctx, '2026-12-27')).toBe(false)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'closure.created' } })).toBe(1)
  })

  test('isClosedOn não enxerga fechamento de outra conta e valida a data', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    await createClosure(await makeCtx(outra), { startDate: '2026-12-24', endDate: '2026-12-24' })
    const ctx = await makeCtx(b)
    expect(await isClosedOn(ctx, '2026-12-24')).toBe(false)
    expect((await erroDe(isClosedOn(ctx, '24/12/2026'))).code).toBe('validation')
  })

  test('valida datas, ordem e duração máxima de 366 dias', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    expect((await erroDe(createClosure(ctx, { startDate: '2026-12-26', endDate: '2026-12-24' }))).code).toBe(
      'validation',
    )
    expect((await erroDe(createClosure(ctx, { startDate: '2026-02-30', endDate: '2026-03-01' }))).code).toBe(
      'validation',
    )
    expect((await erroDe(createClosure(ctx, { startDate: 'ontem', endDate: '2026-03-01' }))).code).toBe('validation')
    // 2026-01-01 a 2027-01-02 são 367 dias; 2027-01-01 são 366.
    expect((await erroDe(createClosure(ctx, { startDate: '2026-01-01', endDate: '2027-01-02' }))).code).toBe(
      'validation',
    )
    expect((await createClosure(ctx, { startDate: '2026-01-01', endDate: '2027-01-01' })).id).toBeTruthy()
    expect((await createClosure(ctx, { startDate: '2026-05-01', endDate: '2026-05-01' })).id).toBeTruthy()
  })

  test('exige manage_settings: gerente cria, profissional e cliente não', async () => {
    const b = await makeBusiness()
    const prof = await ctxComPapel(b, 'PROFESSIONAL')
    expect((await erroDe(createClosure(prof, { startDate: '2026-12-24', endDate: '2026-12-24' }))).code).toBe('forbidden')
    const gerente = await ctxComPapel(b, 'MANAGER')
    expect((await createClosure(gerente, { startDate: '2026-12-24', endDate: '2026-12-24' })).id).toBeTruthy()
    const cliente = await makeCtx(b, { actor: { kind: 'customer', customerId: crypto.randomUUID(), name: 'C' } })
    expect((await erroDe(createClosure(cliente, { startDate: '2026-12-24', endDate: '2026-12-24' }))).code).toBe(
      'forbidden',
    )
  })
})

describe('listClosures', () => {
  test('sem filtro traz os que terminam de hoje (no fuso da conta) em diante, por início', async () => {
    const b = await makeBusiness({ timezone: 'America/Sao_Paulo' })
    // 2026-11-17T01:00Z ainda é 16/11 em São Paulo.
    const ctx = await makeCtx(b, { now: new Date('2026-11-17T01:00:00Z') })
    const passado = await createClosure(ctx, { startDate: '2026-11-10', endDate: '2026-11-15' })
    const terminaHoje = await createClosure(ctx, { startDate: '2026-11-14', endDate: '2026-11-16' })
    const futuro = await createClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-25' })
    const proximo = await createClosure(ctx, { startDate: '2026-11-20', endDate: '2026-11-20' })
    const lista = await listClosures(ctx)
    expect(lista.map((x) => x.id)).toEqual([terminaHoje.id, proximo.id, futuro.id])
    expect(lista.map((x) => x.id)).not.toContain(passado.id)
  })

  test('com from/to traz os que tocam o intervalo', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const a = await createClosure(ctx, { startDate: '2026-12-01', endDate: '2026-12-05' })
    const c = await createClosure(ctx, { startDate: '2026-12-10', endDate: '2026-12-12' })
    await createClosure(ctx, { startDate: '2026-12-20', endDate: '2026-12-21' })
    const lista = await listClosures(ctx, { from: '2026-12-05', to: '2026-12-10' })
    expect(lista.map((x) => x.id)).toEqual([a.id, c.id])
    expect((await listClosures(ctx, { from: '2026-12-13', to: '2026-12-19' }))).toEqual([])
    expect((await erroDe(listClosures(ctx, { from: '2026-12-10', to: '2026-12-05' }))).code).toBe('validation')
  })
})

describe('deleteClosure', () => {
  test('apaga e audita; de outra conta ou malformado dá not_found; profissional não apaga', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    const f = await createClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-24' })
    const alheio = await createClosure(await makeCtx(outra), { startDate: '2026-12-24', endDate: '2026-12-24' })
    const prof = await ctxComPapel(b, 'PROFESSIONAL')
    expect((await erroDe(deleteClosure(prof, f.id))).code).toBe('forbidden')
    expect((await erroDe(deleteClosure(ctx, alheio.id))).code).toBe('not_found')
    expect((await erroDe(deleteClosure(ctx, 'xyz'))).code).toBe('not_found')
    await deleteClosure(ctx, f.id)
    expect(await isClosedOn(ctx, '2026-12-24')).toBe(false)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'closure.deleted' } })).toBe(1)
    expect(await prisma.businessClosure.count({ where: { id: alheio.id } })).toBe(1)
  })
})
