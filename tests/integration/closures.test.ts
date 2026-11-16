import { prisma } from '@/server/db/client'
import { createClosure, deleteClosure, isClosedOn, listClosures } from '@/server/domain/settings/closures'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeAppointment, makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService } from '../setup/factories'

beforeEach(resetDb)

describe('createClosure: agendamentos afetados', () => {
  test('conta pendentes e confirmados de toda a conta nos dias do fechamento, no fuso local, sem recusar', async () => {
    const b = await makeBusiness({ timezone: 'America/Sao_Paulo' })
    const ctx = await makeCtx(b)
    const s = await makeService(b.id, { durationMin: 30 })
    const ana = await makeProfessional(b.id, { serviceIds: [s.id] })
    const caio = await makeProfessional(b.id, { serviceIds: [s.id] })
    const c = await makeCustomer(b.id)
    const base = { customerId: c.id, serviceId: s.id }
    // Fechamento de 24 a 25/12 em São Paulo (UTC-3): de 24/12 03:00Z até 26/12 03:00Z.
    await makeAppointment(b.id, { ...base, professionalId: ana.id, startsAt: new Date('2026-12-24T13:00:00Z'), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, professionalId: caio.id, startsAt: new Date('2026-12-25T13:00:00Z'), status: 'PENDING' })
    // 25/12 23:30 local ainda é dentro; 26/12 00:00 local (03:00Z) já é fora.
    await makeAppointment(b.id, { ...base, professionalId: ana.id, startsAt: new Date('2026-12-26T02:30:00Z'), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, professionalId: caio.id, startsAt: new Date('2026-12-26T03:00:00Z'), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, professionalId: ana.id, startsAt: new Date('2026-12-24T14:00:00Z'), status: 'CANCELED' })
    await makeAppointment(b.id, { ...base, professionalId: ana.id, startsAt: new Date('2026-12-23T13:00:00Z'), status: 'CONFIRMED' })
    const f = await createClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-25', reason: 'Natal' })
    expect(f.affectedAppointments).toBe(3)
    expect(await prisma.businessClosure.count({ where: { businessId: b.id } })).toBe(1)
  })
})

describe('createClosure e isClosedOn', () => {
  test('fechado no primeiro e no último dia, aberto antes e depois', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const f = await createClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-26', reason: '  Natal  ' })
    expect(f).toEqual({ id: f.id, startDate: '2026-12-24', endDate: '2026-12-26', reason: 'Natal', affectedAppointments: 0 })
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
    expect((await domainError(isClosedOn(ctx, '24/12/2026'))).code).toBe('validation')
  })

  test('valida datas, ordem e duração máxima de 366 dias', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    expect((await domainError(createClosure(ctx, { startDate: '2026-12-26', endDate: '2026-12-24' }))).code).toBe(
      'validation',
    )
    expect((await domainError(createClosure(ctx, { startDate: '2026-02-30', endDate: '2026-03-01' }))).code).toBe(
      'validation',
    )
    expect((await domainError(createClosure(ctx, { startDate: 'ontem', endDate: '2026-03-01' }))).code).toBe('validation')
    // 2026-01-01 a 2027-01-02 são 367 dias; 2027-01-01 são 366.
    expect((await domainError(createClosure(ctx, { startDate: '2026-01-01', endDate: '2027-01-02' }))).code).toBe(
      'validation',
    )
    expect((await createClosure(ctx, { startDate: '2026-01-01', endDate: '2027-01-01' })).id).toBeTruthy()
    expect((await createClosure(ctx, { startDate: '2026-05-01', endDate: '2026-05-01' })).id).toBeTruthy()
  })

  test('exige manage_settings: gerente cria, profissional e cliente não', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(createClosure(prof, { startDate: '2026-12-24', endDate: '2026-12-24' }))).code).toBe('forbidden')
    const gerente = await ctxWithRole(b, 'MANAGER')
    expect((await createClosure(gerente, { startDate: '2026-12-24', endDate: '2026-12-24' })).id).toBeTruthy()
    const cliente = await makeCtx(b, { actor: { kind: 'customer', customerId: crypto.randomUUID(), name: 'C' } })
    expect((await domainError(createClosure(cliente, { startDate: '2026-12-24', endDate: '2026-12-24' }))).code).toBe(
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
    expect((await domainError(listClosures(ctx, { from: '2026-12-10', to: '2026-12-05' }))).code).toBe('validation')
  })
})

describe('deleteClosure', () => {
  test('apaga e audita; de outra conta ou malformado dá not_found; profissional não apaga', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    const f = await createClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-24' })
    const alheio = await createClosure(await makeCtx(outra), { startDate: '2026-12-24', endDate: '2026-12-24' })
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(deleteClosure(prof, f.id))).code).toBe('forbidden')
    expect((await domainError(deleteClosure(ctx, alheio.id))).code).toBe('not_found')
    expect((await domainError(deleteClosure(ctx, 'xyz'))).code).toBe('not_found')
    await deleteClosure(ctx, f.id)
    expect(await isClosedOn(ctx, '2026-12-24')).toBe(false)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'closure.deleted' } })).toBe(1)
    expect(await prisma.businessClosure.count({ where: { id: alheio.id } })).toBe(1)
  })
})
