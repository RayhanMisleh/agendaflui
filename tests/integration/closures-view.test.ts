import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { createClosure, listClosuresFor, previewClosure } from '@/server/domain/settings/closures'
import { previewTimeBlock } from '@/server/domain/team/time-blocks'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makePlatformAdmin,
  makeProfessional,
  makeService,
  memberOf,
} from '../setup/factories'

beforeEach(resetDb)

describe('listClosuresFor', () => {
  test('gerente e dono veem o motivo; profissional vê só o rótulo das datas, sem motivo', async () => {
    const b = await makeBusiness()
    const dono = await makeCtx(b)
    await createClosure(dono, { startDate: '2026-12-24', endDate: '2026-12-26', reason: 'Recesso de Natal' })
    await createClosure(dono, { startDate: '2026-12-31', endDate: '2026-12-31', reason: null })
    const q = { from: '2026-12-01', to: '2026-12-31' }
    const gerente = await ctxWithRole(b, 'MANAGER')
    const comMotivo = await listClosuresFor(gerente, q)
    expect(comMotivo.map((c) => [c.startDate, c.endDate, c.reason])).toEqual([
      ['2026-12-24', '2026-12-26', 'Recesso de Natal'],
      ['2026-12-31', '2026-12-31', null],
    ])
    expect(comMotivo.map((c) => c.label)).toEqual(['24/12/2026 a 26/12/2026', '31/12/2026'])
    const prof = await listClosuresFor(await ctxWithRole(b, 'PROFESSIONAL'), q)
    expect(prof).toHaveLength(2)
    for (const c of prof) expect(Object.keys(c)).not.toContain('reason')
    expect(JSON.stringify(prof)).not.toContain('Recesso')
    expect((await listClosuresFor(dono, q))[0]?.reason).toBe('Recesso de Natal')
  })

  test('o suporte vê o motivo; o admin da plataforma e quem não é da equipe não listam', async () => {
    const b = await makeBusiness()
    await createClosure(await makeCtx(b), { startDate: '2026-12-24', endDate: '2026-12-24', reason: 'Natal' })
    const admin = await makePlatformAdmin()
    const suporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } })
    expect((await listClosuresFor(suporte, { from: '2026-12-01', to: '2026-12-31' }))[0]?.reason).toBe('Natal')
    const cliente = await makeCtx(b, { actor: { kind: 'customer', customerId: crypto.randomUUID(), name: 'C' } })
    expect((await domainError(listClosuresFor(cliente, { from: '2026-12-01', to: '2026-12-31' }))).code).toBe('forbidden')
  })

  test('devolve só os que tocam o intervalo e de outra conta nunca', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const ctx = await makeCtx(b)
    await createClosure(ctx, { startDate: '2026-11-30', endDate: '2026-12-02' })
    await createClosure(ctx, { startDate: '2027-01-10', endDate: '2027-01-11' })
    await createClosure(await makeCtx(outra), { startDate: '2026-12-05', endDate: '2026-12-05' })
    const r = await listClosuresFor(ctx, { from: '2026-12-01', to: '2026-12-31' })
    expect(r.map((c) => c.startDate)).toEqual(['2026-11-30'])
  })

  test('o intervalo pedido tem teto de 400 dias e precisa estar na ordem', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    expect((await listClosuresFor(ctx, { from: '2026-01-01', to: '2027-02-04' })).length).toBe(0) // 400 dias
    const longo = await domainError(listClosuresFor(ctx, { from: '2026-01-01', to: '2027-02-05' })) // 401
    expect(longo.code).toBe('validation')
    expect(Object.keys(longo.fields ?? {})).toContain('to')
    expect((await domainError(listClosuresFor(ctx, { from: '2026-12-10', to: '2026-12-01' }))).code).toBe('validation')
    expect((await domainError(listClosuresFor(ctx, { from: '10/12/2026', to: '2026-12-11' }))).code).toBe('validation')
  })
})

describe('previewClosure', () => {
  test('conta só pendentes e confirmados nos dias, no fuso da conta, sem gravar nada', async () => {
    const b = await makeBusiness({ timezone: 'America/Manaus' })
    const ctx = await makeCtx(b)
    const s = await makeService(b.id, { durationMin: 30 })
    const p = await makeProfessional(b.id, { serviceIds: [s.id] })
    const c = await makeCustomer(b.id)
    const base = { customerId: c.id, serviceId: s.id, professionalId: p.id }
    // Manaus é UTC-4: o dia 24/12 local vai de 24/12 04:00Z a 25/12 04:00Z.
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-12-24T04:00:00Z'), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-12-25T03:30:00Z'), status: 'PENDING' })
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-12-25T04:00:00Z'), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-12-24T03:00:00Z'), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-12-24T10:00:00Z'), status: 'CANCELED' })
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-12-24T12:00:00Z'), status: 'COMPLETED' })
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-12-24T14:00:00Z'), status: 'NO_SHOW' })
    expect(await previewClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-24' })).toEqual({ affectedAppointments: 2 })
    expect(await prisma.businessClosure.count({ where: { businessId: b.id } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('mesma conta do createClosure; só quem gerencia configurações prevê; mesmas validações', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id)
    const p = await makeProfessional(b.id, { serviceIds: [s.id] })
    const c = await makeCustomer(b.id)
    await makeAppointment(b.id, { customerId: c.id, serviceId: s.id, professionalId: p.id, startsAt: new Date('2026-12-24T15:00:00Z') })
    const previa = await previewClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-25' })
    const criado = await createClosure(ctx, { startDate: '2026-12-24', endDate: '2026-12-25' })
    expect(previa.affectedAppointments).toBe(criado.affectedAppointments)
    expect((await domainError(previewClosure(await ctxWithRole(b, 'PROFESSIONAL'), { startDate: '2026-12-24', endDate: '2026-12-24' }))).code).toBe('forbidden')
    expect((await previewClosure(await ctxWithRole(b, 'MANAGER'), { startDate: '2026-12-24', endDate: '2026-12-24' })).affectedAppointments).toBe(1)
    expect((await domainError(previewClosure(ctx, { startDate: '2026-12-26', endDate: '2026-12-24' }))).code).toBe('validation')
    expect((await domainError(previewClosure(ctx, { startDate: '2026-01-01', endDate: '2027-12-31' }))).code).toBe('validation')
  })
})

describe('previewTimeBlock', () => {
  test('conta só os pendentes e confirmados do profissional que tocam o intervalo e não grava', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id, { durationMin: 60 })
    const p = await makeProfessional(b.id, { serviceIds: [s.id] })
    const outro = await makeProfessional(b.id, { serviceIds: [s.id] })
    const c = await makeCustomer(b.id)
    const base = { customerId: c.id, serviceId: s.id }
    const inicio = new Date('2026-11-20T13:00:00Z')
    const em = (min: number) => new Date(inicio.getTime() + min * 60_000)
    await makeAppointment(b.id, { ...base, professionalId: p.id, startsAt: em(-30), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, professionalId: p.id, startsAt: em(60), status: 'PENDING' })
    await makeAppointment(b.id, { ...base, professionalId: p.id, startsAt: em(120), status: 'CANCELED' })
    await makeAppointment(b.id, { ...base, professionalId: p.id, startsAt: em(180), status: 'COMPLETED' })
    await makeAppointment(b.id, { ...base, professionalId: p.id, startsAt: em(240), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, professionalId: outro.id, startsAt: em(0), status: 'CONFIRMED' })
    const r = await previewTimeBlock(ctx, { professionalId: p.id, startsAt: em(0), endsAt: em(240) })
    expect(r).toEqual({ affectedAppointments: 2 })
    expect(await prisma.timeBlock.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('profissional só prevê a própria ficha; valida a ordem e o tamanho como a criação', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const meu = await makeProfessional(b.id, { membershipId: memberOf(prof).membershipId })
    const colega = await makeProfessional(b.id)
    const inicio = new Date('2026-11-20T13:00:00Z')
    const depois = new Date('2026-11-20T15:00:00Z')
    expect(await previewTimeBlock(prof, { professionalId: meu.id, startsAt: inicio, endsAt: depois })).toEqual({ affectedAppointments: 0 })
    expect((await domainError(previewTimeBlock(prof, { professionalId: colega.id, startsAt: inicio, endsAt: depois }))).code).toBe('forbidden')
    expect((await domainError(previewTimeBlock(prof, { professionalId: meu.id, startsAt: depois, endsAt: inicio }))).code).toBe('validation')
    const muito = new Date(inicio.getTime() + 61 * 86_400_000)
    expect((await domainError(previewTimeBlock(prof, { professionalId: meu.id, startsAt: inicio, endsAt: muito }))).code).toBe('validation')
  })
})
