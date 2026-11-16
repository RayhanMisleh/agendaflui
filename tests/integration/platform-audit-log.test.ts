import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import type { AuditActorType, Prisma } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { listAudit } from '@/server/domain/platform/audit-log'
import { addMinutes, fromIsoInstant } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCtx, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const NOW = fromIsoInstant('2026-11-16T15:00:00.000Z')
const at = (s: string) => fromIsoInstant(s)
const dias = (d: Date, n: number) => addMinutes(d, n * 24 * 60)

let actor: PlatformAdminActor
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
})

type Linha = {
  createdAt: Date
  action?: string
  businessId?: string | null
  actorType?: AuditActorType
  actorId?: string | null
  actorName?: string
  onBehalf?: boolean
  metadata?: Prisma.InputJsonObject
  targetType?: string
  targetId?: string
}
async function linha(l: Linha) {
  return prisma.auditLog.create({
    data: {
      createdAt: l.createdAt,
      action: l.action ?? 'teste.acao',
      businessId: l.businessId ?? null,
      actorType: l.actorType ?? 'SYSTEM',
      actorId: l.actorId ?? null,
      actorName: l.actorName ?? 'Sistema',
      onBehalf: l.onBehalf ?? false,
      metadata: l.metadata ?? {},
      ...(l.targetType ? { targetType: l.targetType } : {}),
      ...(l.targetId ? { targetId: l.targetId } : {}),
    },
  })
}

describe('listAudit: filtros', () => {
  test('mais recentes primeiro, com o nome da conta por junção e metadata como foi gravada', async () => {
    const b = await makeBusiness({ name: 'Pet Feliz' })
    await linha({ createdAt: at('2026-11-10T10:00:00.000Z'), action: 'a.antiga', businessId: b.id, metadata: { campo: 'valor', n: 3, aninhado: { x: [1, 2] } } })
    await linha({ createdAt: at('2026-11-12T10:00:00.000Z'), action: 'b.nova' })
    const r = await listAudit(actor, {}, NOW)
    expect(r.items.map((i) => i.action)).toEqual(['b.nova', 'a.antiga'])
    expect(r.items[1]).toMatchObject({ businessId: b.id, businessName: 'Pet Feliz', metadata: { campo: 'valor', n: 3, aninhado: { x: [1, 2] } } })
    expect(r.items[0]).toMatchObject({ businessId: null, businessName: null })
    expect(r.items[0]?.at.getTime()).toBe(at('2026-11-12T10:00:00.000Z').getTime())
    expect(r.nextCursor).toBeNull()
  })

  test('filtra por conta, por ação, por tipo de autor e por período, combinados', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    await linha({ createdAt: at('2026-11-10T10:00:00.000Z'), action: 'x.criar', businessId: a.id, actorType: 'PLATFORM_ADMIN', actorName: 'Ana' })
    await linha({ createdAt: at('2026-11-11T10:00:00.000Z'), action: 'x.criar', businessId: b.id, actorType: 'PLATFORM_ADMIN', actorName: 'Ana' })
    await linha({ createdAt: at('2026-11-12T10:00:00.000Z'), action: 'x.apagar', businessId: a.id, actorType: 'PLATFORM_ADMIN', actorName: 'Ana' })
    await linha({ createdAt: at('2026-11-13T10:00:00.000Z'), action: 'x.criar', businessId: a.id, actorType: 'SYSTEM' })
    await linha({ createdAt: at('2026-11-14T10:00:00.000Z'), action: 'x.criar', businessId: a.id, actorType: 'PLATFORM_ADMIN', actorName: 'Ana' })

    const acoes = async (q: Parameters<typeof listAudit>[1]) => (await listAudit(actor, q, NOW)).items.map((i) => `${i.action}@${i.at.toISOString().slice(8, 10)}`)
    expect(await acoes({ businessId: a.id })).toEqual(['x.criar@14', 'x.criar@13', 'x.apagar@12', 'x.criar@10'])
    expect(await acoes({ businessId: b.id })).toEqual(['x.criar@11'])
    expect(await acoes({ action: 'x.apagar' })).toEqual(['x.apagar@12'])
    expect(await acoes({ actorType: 'SYSTEM' })).toEqual(['x.criar@13'])
    expect(await acoes({ businessId: a.id, action: 'x.criar', actorType: 'PLATFORM_ADMIN' })).toEqual(['x.criar@14', 'x.criar@10'])
    // `from` inclusivo, `to` exclusivo.
    expect(await acoes({ from: at('2026-11-11T10:00:00.000Z'), to: at('2026-11-13T10:00:00.000Z') })).toEqual(['x.apagar@12', 'x.criar@11'])
    expect(await acoes({ businessId: a.id, from: at('2026-11-12T00:00:00.000Z'), to: at('2026-11-15T00:00:00.000Z') })).toEqual(['x.criar@14', 'x.criar@13', 'x.apagar@12'])
  })

  test('sem período, vale os últimos 30 dias contados de agora', async () => {
    await linha({ createdAt: dias(NOW, -29), action: 'dentro' })
    await linha({ createdAt: dias(NOW, -31), action: 'fora' })
    expect((await listAudit(actor, {}, NOW)).items.map((i) => i.action)).toEqual(['dentro'])
  })

  test('intervalo de 92 dias vale; de 93 dias é recusado, assim como fim antes do início', async () => {
    const to = NOW
    expect((await listAudit(actor, { from: dias(to, -92), to }, NOW)).items).toEqual([])
    const e = await domainError(listAudit(actor, { from: dias(to, -93), to }, NOW))
    expect(e.code).toBe('validation')
    expect(e.fields?.['to']).toMatch(/92 dias/)
    // Só o início, a mais de 92 dias de agora: o fim padrão é agora, então passa de 92 dias.
    expect((await domainError(listAudit(actor, { from: dias(NOW, -100) }, NOW))).code).toBe('validation')
    expect((await domainError(listAudit(actor, { from: to, to: dias(to, -1) }, NOW))).code).toBe('validation')
  })

  test('entradas inválidas: limite, ator, conta e cursor', async () => {
    for (const limit of [0, 101, -1, 1.5]) expect((await domainError(listAudit(actor, { limit }, NOW))).code).toBe('validation')
    expect((await domainError(listAudit(actor, { businessId: 'x' }, NOW))).code).toBe('validation')
    expect((await domainError(listAudit(actor, { actorType: 'ROBO' }, NOW))).code).toBe('validation')
    expect((await domainError(listAudit(actor, { cursor: 'lixo' }, NOW))).code).toBe('validation')
  })

  test('ator que não é admin da plataforma: forbidden', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    expect((await domainError(listAudit(intruso, {}, NOW))).code).toBe('forbidden')
  })
})

describe('listAudit: isolamento entre contas', () => {
  test('com businessId de uma conta, não vem linha de outra conta gravada no mesmo instante', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const mesmo = at('2026-11-14T10:00:00.000Z')
    await linha({ createdAt: mesmo, action: 'da.a', businessId: a.id })
    await linha({ createdAt: mesmo, action: 'da.b', businessId: b.id })
    await linha({ createdAt: mesmo, action: 'da.plataforma' })
    expect((await listAudit(actor, { businessId: a.id }, NOW)).items.map((i) => i.action)).toEqual(['da.a'])
    expect((await listAudit(actor, { businessId: b.id, limit: 1 }, NOW)).items.map((i) => i.action)).toEqual(['da.b'])
  })
})

describe('listAudit: paginação por cursor', () => {
  test('páginas não repetem nem pulam, mesmo com o mesmo instante em várias linhas e inserções entre as páginas', async () => {
    const ids: string[] = []
    // 12 linhas no mesmo instante (empate), mais 13 em instantes diferentes.
    for (let i = 0; i < 12; i++) ids.push((await linha({ createdAt: at('2026-11-14T10:00:00.000Z'), action: `empate.${i}` })).id)
    for (let i = 0; i < 13; i++) ids.push((await linha({ createdAt: addMinutes(at('2026-11-13T10:00:00.000Z'), -i), action: `solta.${i}` })).id)
    const esperado = (await prisma.auditLog.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).map((l) => l.id)

    const vistos: string[] = []
    let cursor: string | undefined
    let paginas = 0
    do {
      const r: Awaited<ReturnType<typeof listAudit>> = await listAudit(actor, { limit: 7, ...(cursor ? { cursor } : {}) }, NOW)
      vistos.push(...r.items.map((i) => i.id))
      paginas += 1
      // Uma linha nova (mais recente que tudo) entra no meio da leitura: não pode deslocar as páginas seguintes.
      if (paginas === 1) await linha({ createdAt: at('2026-11-15T10:00:00.000Z'), action: 'nova' })
      cursor = r.nextCursor ?? undefined
      if (r.nextCursor === null) expect(r.items.length).toBeLessThanOrEqual(7)
    } while (cursor)

    expect(paginas).toBe(4)
    expect(vistos).toEqual(esperado)
    expect(new Set(vistos).size).toBe(25)
  })

  test('limite 100 e padrão de 50 por página; a última página não traz cursor', async () => {
    for (let i = 0; i < 55; i++) await linha({ createdAt: addMinutes(at('2026-11-14T10:00:00.000Z'), -i), action: `l.${i}` })
    const padrao = await listAudit(actor, {}, NOW)
    expect(padrao.items).toHaveLength(50)
    expect(padrao.nextCursor).not.toBeNull()
    const resto = await listAudit(actor, { cursor: padrao.nextCursor as string }, NOW)
    expect(resto.items).toHaveLength(5)
    expect(resto.nextCursor).toBeNull()
    const todas = await listAudit(actor, { limit: 100 }, NOW)
    expect(todas.items).toHaveLength(55)
    expect(todas.nextCursor).toBeNull()
  })
})

describe('listAudit: autor legível', () => {
  test('admin, admin em suporte, dono, gerente, cliente, sistema e membro sem vínculo', async () => {
    const b = await makeBusiness()
    const dono = await makeUser({ name: 'João Silva' })
    const gerente = await makeUser({ name: 'Bia Souza' })
    const ex = await makeUser({ name: 'Caio Lima' })
    await makeMembership(b.id, dono.id, 'OWNER')
    await makeMembership(b.id, gerente.id, 'MANAGER')
    const admin = await makePlatformAdmin({ name: 'Ana' })

    // Pelas funções reais de auditoria: o suporte (impersonator) e o cliente são gravados como o código grava.
    const ctxSuporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: admin.id, name: 'Ana' } })
    await audit(ctxSuporte, { action: 'acao.suporte' })
    const cliente = await prisma.customer.create({ data: { businessId: b.id, name: 'Maria Souza', origin: 'APP' } })
    const ctxCliente = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: 'Maria Souza' } })
    await audit(ctxCliente, { action: 'acao.cliente' })
    await audit(await makeCtx(b, { actor: { kind: 'system' } }), { action: 'acao.sistema' })

    await linha({ createdAt: at('2026-11-14T10:00:00.000Z'), action: 'acao.admin', actorType: 'PLATFORM_ADMIN', actorId: admin.id, actorName: 'Ana' })
    await linha({ createdAt: at('2026-11-14T10:01:00.000Z'), action: 'acao.dono', businessId: b.id, actorType: 'USER', actorId: dono.id, actorName: 'João Silva' })
    await linha({ createdAt: at('2026-11-14T10:02:00.000Z'), action: 'acao.gerente', businessId: b.id, actorType: 'USER', actorId: gerente.id, actorName: 'Bia Souza' })
    await linha({ createdAt: at('2026-11-14T10:03:00.000Z'), action: 'acao.ex', businessId: b.id, actorType: 'USER', actorId: ex.id, actorName: 'Caio Lima' })

    // As três linhas do `audit()` nascem "agora": fixa o instante para ficarem no período consultado.
    await prisma.auditLog.updateMany({ where: { action: { in: ['acao.suporte', 'acao.cliente', 'acao.sistema'] } }, data: { createdAt: at('2026-11-14T09:00:00.000Z') } })

    const r = await listAudit(actor, { businessId: b.id }, NOW)
    const porAcao = Object.fromEntries(r.items.map((i) => [i.action, i.actorLabel]))
    expect(porAcao).toEqual({
      'acao.suporte': 'Admin Ana em suporte',
      'acao.cliente': 'Cliente',
      'acao.sistema': 'Sistema',
      'acao.dono': 'Dono João Silva',
      'acao.gerente': 'Gerente Bia Souza',
      'acao.ex': 'Membro Caio Lima',
    })
    const semConta = await listAudit(actor, { actorType: 'PLATFORM_ADMIN' }, NOW)
    expect(semConta.items.find((i) => i.action === 'acao.admin')?.actorLabel).toBe('Admin Ana')
  })

  test('rótulo do alvo sem consultar outras tabelas, e nulo sem alvo', async () => {
    const id = randomUUID()
    await linha({ createdAt: at('2026-11-14T10:00:00.000Z'), action: 'com.alvo', targetType: 'membership', targetId: id })
    await linha({ createdAt: at('2026-11-14T09:00:00.000Z'), action: 'sem.alvo' })
    const r = await listAudit(actor, {}, NOW)
    expect(r.items[0]?.targetLabel).toBe(`membership ${id.slice(0, 8)}`)
    expect(r.items[1]?.targetLabel).toBeNull()
  })
})
