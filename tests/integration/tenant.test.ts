import { beforeEach, describe, expect, test } from 'vitest'
import type { Business, Membership, User } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { escoparOperacao, tenantDb, TenantViolationError } from '@/server/db/tenant'
import { resetDb } from '../setup/db'
import { makeBusiness, makeMembership, makeUser } from '../setup/factories'

let a: Business, b: Business, ua: User, ub: User, ma: Membership, mb: Membership
beforeEach(async () => {
  await resetDb()
  ;[a, b] = [await makeBusiness(), await makeBusiness()]
  ;[ua, ub] = [await makeUser(), await makeUser()]
  ma = await makeMembership(a.id, ua.id, 'OWNER')
  mb = await makeMembership(b.id, ub.id, 'OWNER')
})

test('findMany só devolve dados da própria conta', async () => {
  expect((await tenantDb(a.id).membership.findMany()).map((m) => m.id)).toEqual([ma.id])
})
test('findUnique de registro de outra conta devolve null', async () => {
  expect(await tenantDb(a.id).membership.findUnique({ where: { id: mb.id } })).toBeNull()
})
test('findUniqueOrThrow, findFirst e findFirstOrThrow não enxergam outra conta', async () => {
  const db = tenantDb(a.id)
  await expect(db.membership.findUniqueOrThrow({ where: { id: mb.id } })).rejects.toThrow()
  expect(await db.membership.findFirst({ where: { id: mb.id } })).toBeNull()
  await expect(db.membership.findFirstOrThrow({ where: { id: mb.id } })).rejects.toThrow()
})
test('where com businessId de outra conta não encontra nada', async () => {
  expect(await tenantDb(a.id).membership.findMany({ where: { businessId: b.id } })).toEqual([])
  expect(await tenantDb(a.id).membership.findMany({ where: { OR: [{ businessId: b.id }] } })).toEqual([])
})
test('update e delete de registro de outra conta falham e nada muda', async () => {
  await expect(tenantDb(a.id).membership.update({ where: { id: mb.id }, data: { active: false } })).rejects.toThrow()
  await expect(tenantDb(a.id).membership.delete({ where: { id: mb.id } })).rejects.toThrow()
  expect((await prisma.membership.findUniqueOrThrow({ where: { id: mb.id } })).active).toBe(true)
})
test('update não move o registro para outra conta', async () => {
  await expect(
    tenantDb(a.id).membership.update({ where: { id: ma.id }, data: { businessId: b.id } }),
  ).rejects.toThrow(TenantViolationError)
  await expect(
    tenantDb(a.id).membership.updateMany({ data: { businessId: b.id } }),
  ).rejects.toThrow(TenantViolationError)
  expect((await prisma.membership.findUniqueOrThrow({ where: { id: ma.id } })).businessId).toBe(a.id)
})
test('updateMany e deleteMany não vazam', async () => {
  expect((await tenantDb(a.id).membership.updateMany({ data: { active: false } })).count).toBe(1)
  expect((await prisma.membership.findUniqueOrThrow({ where: { id: mb.id } })).active).toBe(true)
  expect((await tenantDb(a.id).membership.deleteMany({})).count).toBe(1)
  expect(await prisma.membership.count()).toBe(1)
})
test('updateManyAndReturn e createManyAndReturn respeitam a conta', async () => {
  const db = tenantDb(a.id)
  const atualizadas = await db.membership.updateManyAndReturn({ data: { active: false } })
  expect(atualizadas.map((m) => m.id)).toEqual([ma.id])
  const u1 = await makeUser()
  const criadas = await db.membership.createManyAndReturn({
    data: [{ userId: u1.id, role: 'MANAGER' } as never],
  })
  expect(criadas.map((m) => m.businessId)).toEqual([a.id])
  const u2 = await makeUser()
  await expect(
    db.membership.createMany({ data: [{ businessId: b.id, userId: u2.id, role: 'MANAGER' }] }),
  ).rejects.toThrow(TenantViolationError)
})
test('count e groupBy são da conta', async () => {
  expect(await tenantDb(a.id).membership.count()).toBe(1)
  expect(await tenantDb(a.id).membership.groupBy({ by: ['role'], _count: true })).toHaveLength(1)
  expect((await tenantDb(a.id).membership.aggregate({ _count: true }))._count).toBe(1)
})
test('create grava na conta do cliente', async () => {
  const u = await makeUser()
  const m = await tenantDb(a.id).membership.create({ data: { userId: u.id, role: 'MANAGER' } as never })
  expect(m.businessId).toBe(a.id)
})
test('create apontando para outra conta é violação', async () => {
  const u = await makeUser()
  await expect(
    tenantDb(a.id).membership.create({ data: { businessId: b.id, userId: u.id, role: 'MANAGER' } }),
  ).rejects.toThrow(TenantViolationError)
})
test('upsert não alcança nem cria em outra conta', async () => {
  const db = tenantDb(a.id)
  await expect(
    db.businessBranding.upsert({
      where: { businessId: b.id },
      create: { businessId: b.id, displayName: 'x' },
      update: { displayName: 'x' },
    }),
  ).rejects.toThrow(TenantViolationError)
  await expect(
    db.businessBranding.upsert({
      where: { businessId: b.id },
      create: { displayName: 'x' } as never,
      update: { displayName: 'x' },
    }),
  ).rejects.toThrow()
  expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: b.id } })).displayName).not.toBe('x')
  const r = await db.businessBranding.upsert({
    where: { businessId: a.id },
    create: { displayName: 'novo' } as never,
    update: { displayName: 'novo' },
  })
  expect(r.businessId).toBe(a.id)
})
test('tabelas chaveadas pela conta (marca) também são isoladas', async () => {
  expect(await tenantDb(a.id).businessBranding.findMany()).toHaveLength(1)
  await expect(
    tenantDb(a.id).businessBranding.update({ where: { businessId: b.id }, data: { displayName: 'x' } }),
  ).rejects.toThrow()
})
test('businessId inválido é recusado', () => {
  expect(() => tenantDb('')).toThrow()
  expect(() => tenantDb('não-é-uuid')).toThrow()
})
test('modelos globais passam sem alteração', async () => {
  expect(await tenantDb(a.id).business.count()).toBe(2)
  expect(await tenantDb(a.id).user.count()).toBe(2)
})
test('operação desconhecida em modelo tenant falha fechada', () => {
  expect(() => escoparOperacao('Membership', 'operacaoNova', {}, a.id)).toThrow(TenantViolationError)
})
test('SQL cru não está disponível no cliente por conta', async () => {
  const db = tenantDb(a.id)
  await expect(db.$queryRaw`select 1`).rejects.toThrow(TenantViolationError)
  await expect(db.$executeRaw`select 1`).rejects.toThrow(TenantViolationError)
  await expect(db.$queryRawUnsafe('select 1')).rejects.toThrow(TenantViolationError)
  await expect(db.$executeRawUnsafe('select 1')).rejects.toThrow(TenantViolationError)
})
test('$transaction interativa continua filtrada pela conta', async () => {
  const db = tenantDb(a.id)
  const vistos = await db.$transaction(async (tx) => {
    expect(await tx.membership.findUnique({ where: { id: mb.id } })).toBeNull()
    return tx.membership.findMany()
  })
  expect(vistos.map((m) => m.id)).toEqual([ma.id])
  await db.$transaction(async (tx) => {
    expect((await tx.membership.updateMany({ data: { active: false } })).count).toBe(1)
  })
  expect((await prisma.membership.findUniqueOrThrow({ where: { id: mb.id } })).active).toBe(true)
})
test('$transaction em lote continua filtrada pela conta', async () => {
  const db = tenantDb(a.id)
  const [lista, total] = await db.$transaction([db.membership.findMany(), db.membership.count()])
  expect(lista).toHaveLength(1)
  expect(total).toBe(1)
})
describe('relações', () => {
  test('include de relação só traz a própria conta', async () => {
    const r = await tenantDb(a.id).membership.findMany({ include: { business: true } })
    expect(r.map((m) => m.business.id)).toEqual([a.id])
  })
})
