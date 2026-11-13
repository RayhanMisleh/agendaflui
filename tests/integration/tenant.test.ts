import { beforeEach, describe, expect, test } from 'vitest'
import type { Business, Membership, User } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { escoparOperacao, lerMetadados, tenantDb, TenantViolationError } from '@/server/db/tenant'
import { resetDb } from '../setup/db'
import { makeAuditLog, makeBusiness, makeMembership, makeUpload, makeUser } from '../setup/factories'

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
test('modelo não classificado falha fechado', () => {
  expect(() => escoparOperacao('ModeloNovo', 'findMany', {}, a.id)).toThrow(TenantViolationError)
})

describe('Business (a própria conta)', () => {
  test('leituras só enxergam a conta A', async () => {
    const db = tenantDb(a.id)
    expect((await db.business.findMany()).map((x) => x.id)).toEqual([a.id])
    expect(await db.business.findUnique({ where: { id: b.id } })).toBeNull()
    expect(await db.business.count()).toBe(1)
  })
  test('update de outra conta rejeita e nada muda; da própria funciona', async () => {
    await expect(tenantDb(a.id).business.update({ where: { id: b.id }, data: { name: 'x' } })).rejects.toThrow()
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).name).toBe(b.name)
    await tenantDb(a.id).business.update({ where: { id: a.id }, data: { name: 'Nova' } })
    expect((await prisma.business.findUniqueOrThrow({ where: { id: a.id } })).name).toBe('Nova')
    expect((await tenantDb(a.id).business.updateMany({ data: { city: 'X' } })).count).toBe(1)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).city).toBeNull()
  })
  test('delete, deleteMany, create e upsert lançam violação', async () => {
    const db = tenantDb(a.id)
    await expect(db.business.delete({ where: { id: b.id } })).rejects.toThrow(TenantViolationError)
    await expect(db.business.deleteMany({})).rejects.toThrow(TenantViolationError)
    await expect(db.business.create({ data: { slug: 'nova-conta', name: 'x' } })).rejects.toThrow(TenantViolationError)
    await expect(
      db.business.upsert({ where: { id: a.id }, create: { slug: 'nova-conta', name: 'x' }, update: {} }),
    ).rejects.toThrow(TenantViolationError)
    expect(await prisma.business.count()).toBe(2)
  })
  test('trocar o id em update lança', async () => {
    await expect(
      tenantDb(a.id).business.update({ where: { id: a.id }, data: { id: b.id } }),
    ).rejects.toThrow(TenantViolationError)
    await expect(
      tenantDb(a.id).business.update({ where: { id: a.id }, data: { id: { set: b.id } } as never }),
    ).rejects.toThrow(TenantViolationError)
  })
  test('ataque: escrita aninhada na marca de outra conta lança e nada muda', async () => {
    await expect(
      tenantDb(a.id).business.update({
        where: { id: b.id },
        data: { branding: { update: { displayName: 'HACK' } } },
      }),
    ).rejects.toThrow(TenantViolationError)
    expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: b.id } })).displayName).not.toBe('HACK')
  })
})

describe('Upload e AuditLog (business_id anulável)', () => {
  let ua1: Awaited<ReturnType<typeof makeUpload>>
  let ub1: Awaited<ReturnType<typeof makeUpload>>
  let up1: Awaited<ReturnType<typeof makeUpload>>
  let la1: Awaited<ReturnType<typeof makeAuditLog>>
  let lb1: Awaited<ReturnType<typeof makeAuditLog>>
  let lp1: Awaited<ReturnType<typeof makeAuditLog>>
  beforeEach(async () => {
    ;[ua1, ub1, up1] = [await makeUpload(a.id), await makeUpload(b.id), await makeUpload(null)]
    ;[la1, lb1, lp1] = [await makeAuditLog(a.id), await makeAuditLog(b.id), await makeAuditLog(null)]
  })
  test('findMany só devolve a conta A', async () => {
    expect((await tenantDb(a.id).upload.findMany()).map((x) => x.id)).toEqual([ua1.id])
    expect((await tenantDb(a.id).auditLog.findMany()).map((x) => x.id)).toEqual([la1.id])
  })
  test('create grava a conta A', async () => {
    const u = await tenantDb(a.id).upload.create({
      data: { path: 'x.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, createdByType: 'SYSTEM' } as never,
    })
    expect(u.businessId).toBe(a.id)
    const l = await tenantDb(a.id).auditLog.create({
      data: { actorType: 'SYSTEM', actorName: 's', action: 'x' } as never,
    })
    expect(l.businessId).toBe(a.id)
  })
  test('update e delete de registro de B ou da plataforma rejeitam', async () => {
    const db = tenantDb(a.id)
    for (const id of [ub1.id, up1.id]) {
      await expect(db.upload.update({ where: { id }, data: { width: 9 } })).rejects.toThrow()
      await expect(db.upload.delete({ where: { id } })).rejects.toThrow()
    }
    for (const id of [lb1.id, lp1.id]) {
      await expect(db.auditLog.update({ where: { id }, data: { action: 'x' } })).rejects.toThrow()
      await expect(db.auditLog.delete({ where: { id } })).rejects.toThrow()
    }
    expect(await prisma.upload.count()).toBe(3)
    expect(await prisma.auditLog.count()).toBe(3)
    expect((await prisma.upload.findUniqueOrThrow({ where: { id: up1.id } })).width).toBe(1)
  })
  test('update não tira o registro da conta', async () => {
    await expect(
      tenantDb(a.id).upload.update({ where: { id: ua1.id }, data: { businessId: null } }),
    ).rejects.toThrow(TenantViolationError)
  })
})

describe('modelos de plataforma', () => {
  test('user, session e platformAdmin são recusados', async () => {
    const db = tenantDb(a.id)
    await expect(db.user.findMany()).rejects.toThrow(TenantViolationError)
    await expect(db.session.findMany()).rejects.toThrow(TenantViolationError)
    await expect(db.platformAdmin.findMany()).rejects.toThrow(TenantViolationError)
    await expect(db.userToken.count()).rejects.toThrow(TenantViolationError)
  })
})

describe('relações', () => {
  test('include de business e de business → branding só trazem a própria conta', async () => {
    const r = await tenantDb(a.id).membership.findMany({ include: { business: true } })
    expect(r.map((m) => m.business.id)).toEqual([a.id])
    const r2 = await tenantDb(a.id).membership.findMany({ include: { business: { include: { branding: true } } } })
    expect(r2.map((m) => m.business.branding?.businessId)).toEqual([a.id])
  })
  test('entrar em modelo de plataforma por include ou select lança', async () => {
    const db = tenantDb(a.id)
    await expect(db.membership.findMany({ include: { user: true } })).rejects.toThrow(TenantViolationError)
    await expect(
      db.membership.findMany({ select: { id: true, user: { select: { name: true } } } }),
    ).rejects.toThrow(TenantViolationError)
    await expect(
      db.membership.findMany({ include: { user: { include: { memberships: true } } } }),
    ).rejects.toThrow(TenantViolationError)
    await expect(
      db.membership.findMany({ include: { business: { include: { sessions: true } } } }),
    ).rejects.toThrow(TenantViolationError)
    await expect(
      db.business.findMany({ include: { _count: { select: { sessions: true } } } }),
    ).rejects.toThrow(TenantViolationError)
    await expect(db.business.findMany({ include: { _count: true } })).rejects.toThrow(TenantViolationError)
  })
  test('_count de relação permitida funciona', async () => {
    const r = await tenantDb(a.id).business.findMany({ include: { _count: { select: { memberships: true } } } })
    expect(r[0]?._count.memberships).toBe(1)
  })
  test('escrita aninhada lança; chave escalar funciona', async () => {
    const u = await makeUser()
    const db = tenantDb(a.id)
    await expect(
      db.membership.create({ data: { role: 'MANAGER', user: { connect: { id: u.id } } } as never }),
    ).rejects.toThrow(TenantViolationError)
    await expect(
      db.membership.update({ where: { id: ma.id }, data: { user: { update: { name: 'HACK' } } } }),
    ).rejects.toThrow(TenantViolationError)
    expect(await prisma.membership.count()).toBe(2)
    const m = await db.membership.create({ data: { role: 'MANAGER', userId: u.id } as never })
    expect(m.businessId).toBe(a.id)
  })
})

describe('relações entre contas (FK composta)', () => {
  const colunas = ['logoUploadId', 'symbolUploadId', 'faviconUploadId', 'loginImageUploadId'] as const

  test('marca não aceita upload de outra conta nem da plataforma, mas aceita da própria', async () => {
    const ub1 = await makeUpload(b.id)
    const up1 = await makeUpload(null)
    const ua1 = await makeUpload(a.id)
    const antes = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: a.id } })
    for (const coluna of colunas) {
      for (const alheio of [ub1, up1]) {
        await expect(
          tenantDb(a.id).businessBranding.update({ where: { businessId: a.id }, data: { [coluna]: alheio.id } }),
          coluna,
        ).rejects.toThrow()
      }
    }
    expect(await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: a.id } })).toEqual(antes)
    const ok = await tenantDb(a.id).businessBranding.update({
      where: { businessId: a.id },
      data: { logoUploadId: ua1.id },
    })
    expect(ok.logoUploadId).toBe(ua1.id)
  })

  test('ataque em dois passos não devolve dados de B', async () => {
    const ub1 = await makeUpload(b.id)
    await expect(
      tenantDb(a.id).businessBranding.update({ where: { businessId: a.id }, data: { logoUploadId: ub1.id } }),
    ).rejects.toThrow()
    const r = await tenantDb(a.id).businessBranding.findMany({
      include: { logo: { include: { business: { include: { memberships: true, settings: true } } } } },
    })
    expect(r).toHaveLength(1)
    expect(r[0]?.logo).toBeNull()
  })

  test('apagar o upload que é logo anula logoUploadId e mantém a marca', async () => {
    const ua1 = await makeUpload(a.id)
    await prisma.businessBranding.update({ where: { businessId: a.id }, data: { logoUploadId: ua1.id } })
    await prisma.upload.delete({ where: { id: ua1.id } })
    const marca = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: a.id } })
    expect(marca.logoUploadId).toBeNull()
    expect(marca.businessId).toBe(a.id)
  })
})

describe('metadados de relação', () => {
  const valido = { models: { A: { fields: [{ name: 'x', kind: 'scalar' }, { name: 'r', kind: 'object', type: 'A' }] } } }
  test('formato válido é aceito', () => {
    expect(lerMetadados(valido).get('A')).toHaveLength(2)
  })
  test('campo sem kind, sem name ou relação com alvo desconhecido falham fechado', () => {
    expect(() => lerMetadados({ models: { A: { fields: [{ name: 'x' }] } } })).toThrow(TenantViolationError)
    expect(() => lerMetadados({ models: { A: { fields: [{ kind: 'scalar' }] } } })).toThrow(TenantViolationError)
    expect(() =>
      lerMetadados({ models: { A: { fields: [{ name: 'r', kind: 'object', type: 'Z' }] } } }),
    ).toThrow(TenantViolationError)
    expect(() => lerMetadados({})).toThrow(TenantViolationError)
  })
})
