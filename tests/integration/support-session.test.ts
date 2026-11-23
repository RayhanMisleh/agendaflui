import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { can, CAPABILITIES } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { getMemberSession, getTenantContext, loginUser } from '@/server/auth/member-auth'
import { logoutUser } from '@/server/auth/member-auth'
import { checkSupportLimit, endSupport, redeemSupport, startSupport } from '@/server/auth/support-session'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { createService } from '@/server/domain/catalog/services'
import { setAdminActive } from '@/server/domain/platform/admins'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const jar = new Map<string, { value: string; options: Record<string, unknown> }>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      if (options['maxAge'] === 0) jar.delete(name)
      else jar.set(name, { value, options })
    },
  }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  },
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const AGORA = new Date('2026-11-16T12:00:00.000Z')
let admin: Awaited<ReturnType<typeof makePlatformAdmin>>
let actor: PlatformAdminActor
let business: Awaited<ReturnType<typeof makeBusiness>>

beforeEach(async () => {
  await resetDb()
  jar.clear()
  admin = await makePlatformAdmin({ name: 'Ana Admin' })
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
  business = await makeBusiness({ name: 'Barbearia Central', slug: 'central' })
})

function tokenDaUrl(url: string): string {
  const m = /^http:\/\/painel\.localhost:3000\/suporte\/([A-Za-z0-9_-]+)$/.exec(url)
  if (!m?.[1]) throw new Error(`URL inesperada: ${url}`)
  return m[1]
}

async function abrir(now = AGORA, meta: { ip?: string; userAgent?: string; previousToken?: string } = {}) {
  const { url } = await startSupport(actor, business.id, now)
  const token = tokenDaUrl(url)
  const r = await redeemSupport(token, meta, now)
  if (!r) throw new Error('A troca devia valer.')
  return { token, ...r }
}

describe('startSupport', () => {
  test('devolve o link do host do painel, grava só o hash, 60 s de validade, e audita com o nome do admin', async () => {
    const { url } = await startSupport(actor, business.id, AGORA)
    const token = tokenDaUrl(url)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    const linha = await prisma.supportHandoff.findFirstOrThrow()
    expect(linha).toMatchObject({ adminId: admin.id, businessId: business.id, tokenHash: hashToken(token), usedAt: null })
    expect(linha.expiresAt).toEqual(addMinutes(AGORA, 1))
    expect(JSON.stringify(await prisma.$queryRaw`SELECT to_jsonb(t) AS j FROM support_handoffs t`)).not.toContain(token)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId: business.id, action: 'support.link_issued' } })
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: admin.id, actorName: 'Ana Admin' })
    expect(JSON.stringify(log)).not.toContain(token)
    expect(await prisma.auditLog.count({ where: { action: 'support.started' } })).toBe(0)
  })

  test('quem não é admin, admin desativado e conta arquivada ou inexistente são recusados', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    expect((await domainError(startSupport(intruso, business.id, AGORA))).code).toBe('forbidden')
    expect((await domainError(startSupport({ ...actor, adminId: randomUUID() }, business.id, AGORA))).code).toBe('forbidden')
    expect((await domainError(startSupport(actor, randomUUID(), AGORA))).code).toBe('not_found')
    expect((await domainError(startSupport(actor, 'x', AGORA))).code).toBe('not_found')
    await prisma.business.update({ where: { id: business.id }, data: { status: 'ARCHIVED' } })
    expect((await domainError(startSupport(actor, business.id, AGORA))).code).toBe('business_unavailable')
    expect(await prisma.supportHandoff.count()).toBe(0)
  })
})

describe('redeemSupport', () => {
  test('cria a sessão de suporte de 60 minutos, só com o hash, e o segundo uso devolve null', async () => {
    const { url } = await startSupport(actor, business.id, AGORA)
    const token = tokenDaUrl(url)
    const r = await redeemSupport(token, { ip: '203.0.113.7', userAgent: 'teste' }, addMinutes(AGORA, 0.5))
    expect(r).not.toBeNull()
    expect(r?.slug).toBe('central')
    expect(r?.expiresAt).toEqual(new Date(AGORA.getTime() + 30_000 + 60 * 60_000))
    const sessao = await prisma.session.findFirstOrThrow()
    expect(sessao).toMatchObject({ userId: null, impersonatorAdminId: admin.id, activeBusinessId: business.id, revokedAt: null, ip: '203.0.113.7' })
    expect(sessao.tokenHash).toBe(hashToken(r?.sessionToken ?? ''))
    expect(JSON.stringify(await prisma.$queryRaw`SELECT to_jsonb(t) AS j FROM sessions t`)).not.toContain(r?.sessionToken ?? 'x')
    expect(await redeemSupport(token, {}, addMinutes(AGORA, 0.6))).toBeNull()
    expect(await prisma.session.count()).toBe(1)
    const iniciados = await prisma.auditLog.findMany({ where: { action: 'support.started' } })
    expect(iniciados).toHaveLength(1)
    expect(iniciados[0]).toMatchObject({ businessId: business.id, actorId: admin.id, actorName: 'Ana Admin', onBehalf: false })
  })

  test('token vencido (61 s), desconhecido ou vazio devolve null; com 59 s ainda vale', async () => {
    const a = tokenDaUrl((await startSupport(actor, business.id, AGORA)).url)
    expect(await redeemSupport(a, {}, new Date(AGORA.getTime() + 61_000))).toBeNull()
    const b = tokenDaUrl((await startSupport(actor, business.id, AGORA)).url)
    expect(await redeemSupport(b, {}, new Date(AGORA.getTime() + 59_000))).not.toBeNull()
    expect(await redeemSupport('token-que-nao-existe', {}, AGORA)).toBeNull()
    expect(await redeemSupport('', {}, AGORA)).toBeNull()
  })

  test('duas trocas simultâneas do mesmo token: uma passa', async () => {
    const token = tokenDaUrl((await startSupport(actor, business.id, AGORA)).url)
    const r = await Promise.all([redeemSupport(token, {}, AGORA), redeemSupport(token, {}, AGORA), redeemSupport(token, {}, AGORA)])
    expect(r.filter((x) => x !== null)).toHaveLength(1)
    expect(await prisma.session.count()).toBe(1)
  })

  test('admin desativado ou conta arquivada entre a emissão e a troca: null, e o token fica gasto', async () => {
    const a = tokenDaUrl((await startSupport(actor, business.id, AGORA)).url)
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { active: false } })
    expect(await redeemSupport(a, {}, AGORA)).toBeNull()
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { active: true } })
    expect(await redeemSupport(a, {}, AGORA)).toBeNull()
    const b = tokenDaUrl((await startSupport(actor, business.id, AGORA)).url)
    await prisma.business.update({ where: { id: business.id }, data: { status: 'ARCHIVED' } })
    expect(await redeemSupport(b, {}, AGORA)).toBeNull()
    expect(await prisma.session.count()).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'support.started' } })).toBe(0)
  })

  test('conta suspensa: o suporte entra', async () => {
    const token = tokenDaUrl((await startSupport(actor, business.id, AGORA)).url)
    await prisma.business.update({ where: { id: business.id }, data: { status: 'SUSPENDED' } })
    const r = await redeemSupport(token, {}, AGORA)
    expect(r).not.toBeNull()
    const ctx = await getTenantContext(r?.sessionToken, AGORA)
    expect(ctx?.actor.kind).toBe('impersonator')
  })

  test('a troca revoga a sessão anterior daquele cookie e só ela', async () => {
    const user = await makeUser({ password: 'senha-bem-longa' })
    await makeMembership(business.id, user.id, 'OWNER')
    const anterior = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.1' })
    const outroNavegador = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.1' })
    await abrir(AGORA, { previousToken: anterior.token })
    const rev = async (t: string) => (await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(t) } })).revokedAt
    expect(await rev(anterior.token)).not.toBeNull()
    expect(await rev(outroNavegador.token)).toBeNull()
  })
})

describe('a sessão de suporte', () => {
  test('dá o ator impersonator com os poderes do dono, na conta certa, e a sessão de membro mostra o suporte', async () => {
    const { sessionToken } = await abrir()
    const ctx = await getTenantContext(sessionToken, AGORA)
    if (!ctx) throw new Error('Esperava o contexto de suporte.')
    expect(ctx.actor).toEqual({ kind: 'impersonator', adminId: admin.id, name: 'Ana Admin' })
    expect(ctx.businessId).toBe(business.id)
    expect(ctx.channel).toBe('panel')
    expect(CAPABILITIES.every((c) => can(ctx.actor, c))).toBe(true)
    expect((await ctx.db.business.findMany()).map((b) => b.id)).toEqual([business.id])
    const sessao = await getMemberSession(sessionToken, AGORA)
    expect(sessao).toEqual({ kind: 'support', admin: { id: admin.id, name: 'Ana Admin' }, activeBusinessId: business.id, businessName: 'Barbearia Central' })
    expect(sessao).not.toHaveProperty('user')
  })

  test('vale por 60 minutos sem renovação deslizante', async () => {
    const { sessionToken, expiresAt } = await abrir()
    expect(expiresAt).toEqual(addMinutes(AGORA, 60))
    expect(await getTenantContext(sessionToken, addMinutes(AGORA, 59))).not.toBeNull()
    expect((await prisma.session.findFirstOrThrow()).expiresAt).toEqual(expiresAt)
    expect(await getTenantContext(sessionToken, addMinutes(AGORA, 61))).toBeNull()
    expect(await getMemberSession(sessionToken, addMinutes(AGORA, 61))).toBeNull()
  })

  test('alteração feita em suporte grava a auditoria com o admin como autor e marcada como suporte', async () => {
    const { sessionToken } = await abrir()
    const ctx = await getTenantContext(sessionToken, AGORA)
    if (!ctx) throw new Error('Esperava o contexto de suporte.')
    const servico = await createService(ctx, { name: 'Corte', priceCents: 5000, durationMin: 30 })
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId: business.id, targetId: servico.id } })
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: admin.id, actorName: 'Ana Admin', onBehalf: true })
  })

  test('admin desativado derruba a sessão na leitura seguinte (direto no banco e pela função)', async () => {
    const { sessionToken } = await abrir()
    expect(await getTenantContext(sessionToken, AGORA)).not.toBeNull()
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { active: false } })
    expect(await getTenantContext(sessionToken, AGORA)).toBeNull()
    expect(await getMemberSession(sessionToken, AGORA)).toBeNull()

    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { active: true } })
    const outro = await makePlatformAdmin()
    const segunda = await abrir()
    await setAdminActive({ kind: 'platform_admin', adminId: outro.id, name: outro.name }, admin.id, false)
    expect(await getTenantContext(segunda.sessionToken, AGORA)).toBeNull()
  })

  test('conta arquivada derruba a sessão; conta suspensa não derruba o suporte, mas barra o membro comum', async () => {
    const { sessionToken } = await abrir()
    const user = await makeUser({ password: 'senha-bem-longa' })
    await makeMembership(business.id, user.id, 'OWNER')
    const membro = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.2' })
    expect(await getTenantContext(membro.token, AGORA)).not.toBeNull()

    await prisma.business.update({ where: { id: business.id }, data: { status: 'SUSPENDED' } })
    expect((await getTenantContext(sessionToken, AGORA))?.actor.kind).toBe('impersonator')
    expect(await getTenantContext(membro.token, AGORA)).toBeNull()

    await prisma.business.update({ where: { id: business.id }, data: { status: 'ARCHIVED' } })
    expect(await getTenantContext(sessionToken, AGORA)).toBeNull()
    expect(await getMemberSession(sessionToken, AGORA)).toBeNull()
  })

  test('sessão revogada, token desconhecido e sessão de membro não viram suporte', async () => {
    const { sessionToken } = await abrir()
    await prisma.session.updateMany({ data: { revokedAt: AGORA } })
    expect(await getTenantContext(sessionToken, AGORA)).toBeNull()
    expect(await getTenantContext('qualquer', AGORA)).toBeNull()
    expect(await getTenantContext(undefined, AGORA)).toBeNull()
  })
})

describe('endSupport', () => {
  test('apaga a sessão, audita o fim com o nome do admin e é idempotente', async () => {
    const { sessionToken } = await abrir(new Date())
    await endSupport(sessionToken)
    expect(await prisma.session.count()).toBe(0)
    expect(await getTenantContext(sessionToken, AGORA)).toBeNull()
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId: business.id, action: 'support.ended' } })
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: admin.id, actorName: 'Ana Admin' })
    await endSupport(sessionToken)
    await endSupport('nada')
    expect(await prisma.auditLog.count({ where: { action: 'support.ended' } })).toBe(1)
  })

  test('não apaga sessão de membro', async () => {
    const user = await makeUser({ password: 'senha-bem-longa' })
    await makeMembership(business.id, user.id, 'OWNER')
    const membro = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.2' })
    await endSupport(membro.token)
    expect(await getTenantContext(membro.token, AGORA)).not.toBeNull()
  })
})

describe('suporte encerrado por outro caminho', () => {
  const fim = () => prisma.auditLog.findMany({ where: { businessId: business.id, action: 'support.ended' } })

  test('Sair pelo caminho de membro grava support.ended uma vez; Encerrar depois não duplica', async () => {
    const { sessionToken } = await abrir(new Date())
    await logoutUser(sessionToken)
    expect(await getTenantContext(sessionToken, AGORA)).toBeNull()
    const linhas = await fim()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({ actorId: admin.id, actorName: 'Ana Admin' })
    await endSupport(sessionToken)
    await logoutUser(sessionToken)
    expect(await fim()).toHaveLength(1)
  })

  test('novo login e nova troca de token que revogam a sessão do cookie gravam support.ended', async () => {
    const user = await makeUser({ password: 'senha-bem-longa' })
    await makeMembership(business.id, user.id, 'OWNER')
    const a = await abrir(new Date())
    await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.3', previousToken: a.sessionToken })
    expect(await fim()).toHaveLength(1)
    const b = await abrir(new Date())
    await abrir(new Date(), { previousToken: b.sessionToken })
    expect(await fim()).toHaveLength(2)
    expect(await prisma.session.count({ where: { userId: null } })).toBe(1)
  })

  test('sessão de suporte que apenas vence não grava nada; sessão de membro no logout também não', async () => {
    const { sessionToken } = await abrir()
    await logoutUser(sessionToken).catch(() => undefined)
    await prisma.auditLog.deleteMany({ where: { action: 'support.ended' } })
    const outra = await abrir()
    expect(await getTenantContext(outra.sessionToken, addMinutes(AGORA, 61))).toBeNull()
    expect(await fim()).toHaveLength(0)
    const user = await makeUser({ password: 'senha-bem-longa' })
    await makeMembership(business.id, user.id, 'OWNER')
    const membro = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.4' })
    await logoutUser(membro.token)
    expect(await fim()).toHaveLength(0)
  })

  test('sessão de suporte abre a conta da sessão em requireTenant, sem passar pela entrada', async () => {
    const { sessionToken, expiresAt } = await abrir(new Date())
    jar.set('af_painel_session', { value: sessionToken, options: { expires: expiresAt } })
    const ctx = await requireTenant()
    expect(ctx.businessId).toBe(business.id)
    expect(ctx.actor.kind).toBe('impersonator')
  })
})

describe('entrada do membro (pendência da Fase 1)', () => {
  test('um novo login no mesmo navegador revoga a sessão anterior daquele cookie, e só ela', async () => {
    const user = await makeUser({ password: 'senha-bem-longa' })
    await makeMembership(business.id, user.id, 'OWNER')
    const primeira = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.2' })
    const outroNavegador = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.2' })
    const nova = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.2', previousToken: primeira.token })
    const rev = async (t: string) => (await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(t) } })).revokedAt
    expect(await rev(primeira.token)).not.toBeNull()
    expect(await rev(outroNavegador.token)).toBeNull()
    expect(await rev(nova.token)).toBeNull()
  })
})

describe('rota /suporte/[token]', () => {
  const PAINEL_COOKIE = 'af_painel_session'

  async function chamar(token: string) {
    const { GET } = await import('@/app/painel/suporte/[token]/route')
    return GET(new Request(`http://painel.localhost:3000/suporte/${token}`) as never, { params: Promise.resolve({ token }) })
  }

  test('token certo: define o cookie do painel, redireciona para / e manda cabeçalhos que não vazam a URL', async () => {
    const token = tokenDaUrl((await startSupport(actor, business.id)).url)
    const res = await chamar(token)
    expect([302, 303, 307]).toContain(res.status)
    expect(res.headers.get('location')).toBe('http://painel.localhost:3000/')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const cookie = jar.get(PAINEL_COOKIE)
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
    const sessao = await prisma.session.findFirstOrThrow()
    expect(hashToken(cookie?.value ?? '')).toBe(sessao.tokenHash)
    expect((await getTenantContext(cookie?.value))?.actor.kind).toBe('impersonator')
    expect(cookie?.value).not.toBe(token)
  })

  test('token inválido, usado ou vencido: 404 sem detalhe e sem cookie', async () => {
    const usado = tokenDaUrl((await startSupport(actor, business.id)).url)
    await chamar(usado)
    jar.clear()
    for (const t of [usado, 'lixo', 'x'.repeat(5000)]) {
      const res = await chamar(t)
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect(jar.has(PAINEL_COOKIE)).toBe(false)
  })

  test('a troca pelo navegador revoga a sessão de membro que já estava no cookie', async () => {
    const user = await makeUser({ password: 'senha-bem-longa' })
    await makeMembership(business.id, user.id, 'OWNER')
    const membro = await loginUser({ email: user.email, password: 'senha-bem-longa', ip: '203.0.113.2' })
    jar.set(PAINEL_COOKIE, { value: membro.token, options: {} })
    const token = tokenDaUrl((await startSupport(actor, business.id)).url)
    await chamar(token)
    expect(await getTenantContext(membro.token)).toBeNull()
    expect(jar.get(PAINEL_COOKIE)?.value).not.toBe(membro.token)
  })

  test('limite por IP: depois de 30 pedidos em 15 minutos, até o token bom vira 404', async () => {
    const bom = tokenDaUrl((await startSupport(actor, business.id)).url)
    for (let i = 0; i < 30; i++) expect((await chamar(`lixo-${i}`)).status).toBe(404)
    expect((await chamar(bom)).status).toBe(404)
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('checkSupportLimit', () => {
  test('sem IP confiável o contador é do token: token lixo não atrapalha o de outra pessoa', async () => {
    for (let i = 0; i < 30; i++) await checkSupportLimit(undefined, 'lixo', AGORA)
    await expect(checkSupportLimit(undefined, 'lixo', AGORA)).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(checkSupportLimit(undefined, 'outro-token', AGORA)).resolves.toBeUndefined()
  })

  test('com IP, o contador é do IP (IPv6 por /64)', async () => {
    for (let i = 0; i < 30; i++) await checkSupportLimit('2001:db8::1', `t${i}`, AGORA)
    await expect(checkSupportLimit('2001:db8::2', 'novo', AGORA)).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(checkSupportLimit('2001:db8:0:1::2', 'novo', AGORA)).resolves.toBeUndefined()
  })
})
