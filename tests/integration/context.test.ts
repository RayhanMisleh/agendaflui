import { prisma } from '@/server/db/client'
import type { Actor } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { createTenantContext } from '@/server/auth/context'
import { TenantViolationError } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { DomainError } from '@/server/domain/errors'
import { makeBusiness, makeCtx } from '../setup/factories'

async function erroDe(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  return undefined
}

describe('createTenantContext', () => {
  test('traz o fuso da conta e um db que só enxerga a conta', async () => {
    const a = await makeBusiness({ timezone: 'America/Manaus' })
    const b = await makeBusiness()
    const ctx = await createTenantContext({ businessId: a.id, actor: { kind: 'system' } })
    expect(ctx.businessId).toBe(a.id)
    expect(ctx.timeZone).toBe('America/Manaus')
    expect((await ctx.db.business.findMany()).map((x) => x.id)).toEqual([a.id])
    expect(await ctx.db.business.findUnique({ where: { id: b.id } })).toBeNull()
    expect(ctx.request).toEqual({ ip: null, userAgent: null })
    expect(Math.abs(ctx.clock().getTime() - Date.now())).toBeLessThan(5000)
  })

  test('conta suspensa lança business_unavailable', async () => {
    const a = await makeBusiness({ status: 'SUSPENDED' })
    const e = await erroDe(createTenantContext({ businessId: a.id, actor: { kind: 'system' } }))
    expect(e).toBeInstanceOf(DomainError)
    expect((e as DomainError).code).toBe('business_unavailable')
    expect((e as DomainError).message).toBe('Esta conta não está disponível agora. Fale com o suporte.')
  })

  test('conta inexistente lança not_found', async () => {
    const e = await erroDe(
      createTenantContext({ businessId: '00000000-0000-4000-8000-000000000000', actor: { kind: 'system' } }),
    )
    expect(e).toBeInstanceOf(DomainError)
    expect((e as DomainError).code).toBe('not_found')
    expect((e as DomainError).message).toBe('Conta não encontrada.')
  })

  test('conta arquivada lança business_unavailable', async () => {
    const a = await makeBusiness({ status: 'ARCHIVED' })
    const e = await erroDe(createTenantContext({ businessId: a.id, actor: { kind: 'system' } }))
    expect((e as DomainError).code).toBe('business_unavailable')
  })

  test('usa o relógio e os dados da requisição injetados', async () => {
    const a = await makeBusiness()
    const now = new Date('2026-11-16T12:00:00.000Z')
    const request = { ip: '10.0.0.1', userAgent: 'teste' }
    const ctx = await createTenantContext({ businessId: a.id, actor: { kind: 'system' }, clock: () => now, request })
    expect(ctx.clock()).toBe(now)
    expect(ctx.request).toEqual(request)
  })
})

describe('makeCtx', () => {
  test('cria dono com vínculo e usa o relógio fixo', async () => {
    const a = await makeBusiness()
    const now = new Date('2026-11-16T12:00:00.000Z')
    const ctx = await makeCtx(a, { now })
    expect(ctx.clock()).toBe(now)
    expect(ctx.actor.kind).toBe('member')
    if (ctx.actor.kind !== 'member') throw new Error('esperado member')
    expect(ctx.actor.role).toBe('OWNER')
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: ctx.actor.membershipId } })
    expect(m.businessId).toBe(a.id)
    expect(m.userId).toBe(ctx.actor.userId)
  })
})

describe('can', () => {
  test('cliente não tem nenhuma capacidade', () => {
    expect(can({ kind: 'customer', customerId: 'c', name: 'C' }, 'view_dashboard')).toBe(false)
  })
})

describe('audit', () => {
  test('member grava USER com nome, ação, alvo, ip e conta', async () => {
    const a = await makeBusiness()
    const ctx = await makeCtx(a)
    const ctxIp = { ...ctx, request: { ip: '1.2.3.4', userAgent: null } }
    await audit(ctxIp, { action: 'service.create', targetType: 'service', targetId: 'x1', metadata: { k: 1 } })
    const rows = await prisma.auditLog.findMany({ where: { businessId: a.id } })
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r?.actorType).toBe('USER')
    expect(r?.actorName).toBe(ctx.actor.kind === 'member' ? ctx.actor.name : '')
    expect(r?.actorId).toBe(ctx.actor.kind === 'member' ? ctx.actor.userId : '')
    expect(r?.action).toBe('service.create')
    expect(r?.targetType).toBe('service')
    expect(r?.targetId).toBe('x1')
    expect(r?.metadata).toEqual({ k: 1 })
    expect(r?.ip).toBe('1.2.3.4')
    expect(r?.onBehalf).toBe(false)
  })

  test('impersonator grava PLATFORM_ADMIN com onBehalf', async () => {
    const a = await makeBusiness()
    const actor: Actor = { kind: 'impersonator', adminId: '11111111-1111-4111-8111-111111111111', name: 'Suporte' }
    const ctx = await makeCtx(a, { actor })
    await audit(ctx, { action: 'x.y' })
    const r = await prisma.auditLog.findFirstOrThrow({ where: { businessId: a.id } })
    expect(r.actorType).toBe('PLATFORM_ADMIN')
    expect(r.onBehalf).toBe(true)
    expect(r.actorName).toBe('Suporte')
    expect(r.actorId).toBe(actor.adminId)
  })

  test('system e customer gravam SYSTEM; customer leva customerId no metadata', async () => {
    const a = await makeBusiness()
    await audit(await makeCtx(a, { actor: { kind: 'system' } }), { action: 's.a' })
    const cid = '22222222-2222-4222-8222-222222222222'
    await audit(await makeCtx(a, { actor: { kind: 'customer', customerId: cid, name: 'Cli' } }), {
      action: 'c.a',
      metadata: { z: 1 },
    })
    const s = await prisma.auditLog.findFirstOrThrow({ where: { businessId: a.id, action: 's.a' } })
    expect(s.actorType).toBe('SYSTEM')
    const c = await prisma.auditLog.findFirstOrThrow({ where: { businessId: a.id, action: 'c.a' } })
    expect(c.actorType).toBe('SYSTEM')
    expect(c.actorName).toBe('Cli')
    expect(c.metadata).toEqual({ z: 1, customerId: cid })
  })
})

describe('audit em transação', () => {
  test('reverte junto com a operação e persiste sem erro', async () => {
    const a = await makeBusiness()
    const ctx = await makeCtx(a)
    await expect(
      ctx.db.$transaction(async (tx) => {
        await audit(ctx, { action: 'tx.rollback' }, tx)
        throw new Error('falha')
      }),
    ).rejects.toThrow('falha')
    expect(await prisma.auditLog.count({ where: { businessId: a.id, action: 'tx.rollback' } })).toBe(0)
    await ctx.db.$transaction(async (tx) => {
      await audit(ctx, { action: 'tx.ok' }, tx)
    })
    expect(await prisma.auditLog.count({ where: { businessId: a.id, action: 'tx.ok' } })).toBe(1)
  })
})

describe('Business em tenantDb: campos permitidos', () => {
  test('situação, slug, fuso e observações internas lançam; name funciona', async () => {
    const a = await makeBusiness()
    const ctx = await makeCtx(a)
    for (const data of [
      { status: 'SUSPENDED' as const },
      { slug: 'outro' },
      { timezone: 'America/Manaus' },
      { internalNotes: 'x' },
    ]) {
      await expect(ctx.db.business.update({ where: { id: a.id }, data })).rejects.toThrow(TenantViolationError)
      await expect(ctx.db.business.updateMany({ data })).rejects.toThrow(TenantViolationError)
      await expect(ctx.db.business.updateManyAndReturn({ data })).rejects.toThrow(TenantViolationError)
    }
    await expect(ctx.db.business.update({ where: { id: a.id }, data: { id: a.id } })).rejects.toThrow(TenantViolationError)
    await expect(
      ctx.db.business.update({ where: { id: a.id }, data: { status: { set: 'SUSPENDED' } } }),
    ).rejects.toThrow(TenantViolationError)
    await expect(
      ctx.db.business.upsert({ where: { id: a.id }, create: { slug: 'x-novo', name: 'x' }, update: { name: 'y' } }),
    ).rejects.toThrow(TenantViolationError)
    await ctx.db.business.update({ where: { id: a.id }, data: { name: 'Novo' } })
    const row = await prisma.business.findUniqueOrThrow({ where: { id: a.id } })
    expect(row.name).toBe('Novo')
    expect(row.status).toBe('ACTIVE')
    expect(row.slug).toBe(a.slug)
  })
})
