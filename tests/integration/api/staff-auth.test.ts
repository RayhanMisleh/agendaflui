import { beforeEach, describe, expect, test, vi } from 'vitest'
import { POST as customerLogout } from '@/app/api/v1/auth/customer/logout/route'
import { POST as customerRefresh } from '@/app/api/v1/auth/customer/refresh/route'
import { POST as login } from '@/app/api/v1/auth/staff/login/route'
import { POST as logout } from '@/app/api/v1/auth/staff/logout/route'
import { POST as refresh } from '@/app/api/v1/auth/staff/refresh/route'
import { GET as staffMe } from '@/app/api/v1/staff/me/route'
import { defineRoute, type RouteHandler } from '@/server/api/define-route'
import { issueTokens, verifyAccessToken } from '@/server/auth/api-tokens'
import { CAPABILITIES } from '@/server/auth/capabilities'
import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import { z } from '@/server/domain/errors'
import { apiError, apiRequest, callRoute, jsonObject } from '../../setup/api'
import { resetDb } from '../../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeProfessional, makeUser } from '../../setup/factories'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

const SENHA = 'senha-bem-longa-9'
const BASE = '/v1/auth/staff'
const meta = { ip: null, userAgent: null }

// Rota de cliente só para provar que o token de equipe não passa nela.
const rotaDoCliente = defineRoute({
  method: 'GET',
  path: '/v1/teste/cliente-da-tarefa-8',
  auth: 'customer',
  summary: 'Rota do cliente',
  tag: 'teste',
  response: z.object({ ok: z.literal(true) }),
  handler: async () => ({ ok: true as const }),
})

let contadorIp = 0
const outroIp = (): string => {
  contadorIp += 1
  return `192.0.2.${contadorIp % 250}`
}

type Conta = { id: string; slug: string }

async function novaConta(): Promise<Conta> {
  const business = await makeBusiness()
  return { id: business.id, slug: business.slug }
}

function chamar(handler: RouteHandler, caminho: string, c: Conta, body: unknown, ip: string = outroIp()) {
  return callRoute(handler, apiRequest('POST', `${BASE}${caminho}`, { business: c.slug, body, headers: { 'x-forwarded-for': ip } }))
}

/** Login sem loja: nenhum `X-Business` (o app descobre a loja pela resposta). `naConta` manda o cabeçalho de propósito. */
const entrar = (_c: Conta, email: string, password: string, ip: string = outroIp(), naConta?: Conta) =>
  callRoute(
    login,
    apiRequest('POST', `${BASE}/login`, { ...(naConta ? { business: naConta.slug } : {}), body: { email, password }, headers: { 'x-forwarded-for': ip } }),
  )

function eu(c: Conta, token: string) {
  return callRoute(staffMe, apiRequest('GET', '/v1/staff/me', { business: c.slug, token, headers: { 'x-forwarded-for': outroIp() } }))
}

function tokensDe(json: unknown): { accessToken: string; refreshToken: string } {
  const t = jsonObject(jsonObject(json).tokens)
  return { accessToken: String(t.accessToken), refreshToken: String(t.refreshToken) }
}

async function membro(c: Conta, role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', email?: string) {
  const user = await makeUser({ email: email ?? `${role.toLowerCase()}-${contadorIp++}@exemplo.test`, password: SENHA })
  const membership = await makeMembership(c.id, user.id, role)
  return { user, membership }
}

beforeEach(resetDb)

describe('entrada da equipe', () => {
  test('entra sem X-Business e recebe tokens, membro e a loja do vínculo; o token vale em staff/me com o slug devolvido', async () => {
    const c = await novaConta()
    const { membership } = await membro(c, 'MANAGER', 'gerente@exemplo.test')
    const r = await callRoute(
      login,
      apiRequest('POST', `${BASE}/login`, { body: { email: 'gerente@exemplo.test', password: SENHA }, headers: { 'x-forwarded-for': outroIp() } }),
    )
    expect(r.status).toBe(200)
    const corpo = jsonObject(r.json)
    expect(jsonObject(corpo.business).slug).toBe(c.slug)
    expect(jsonObject(corpo.member).membershipId).toBe(membership.id)
    const { accessToken } = tokensDe(r.json)
    const me = await eu({ id: c.id, slug: String(jsonObject(corpo.business).slug) }, accessToken)
    expect(me.status).toBe(200)
    expect(jsonObject(me.json).role).toBe('MANAGER')
  })

  test('X-Business de outra loja é ignorado: entra na loja do próprio vínculo', async () => {
    const c = await novaConta()
    const outra = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    const r = await entrar(c, 'dono@exemplo.test', SENHA, undefined, outra)
    expect(r.status).toBe(200)
    expect(jsonObject(jsonObject(r.json).business).id).toBe(c.id)
    expect((await eu(c, tokensDe(r.json).accessToken)).status).toBe(200)
    // O token é da loja do vínculo: na outra loja não vale.
    expect((await eu(outra, tokensDe(r.json).accessToken)).status).toBe(401)
  })

  test('o dono entra; staff/me devolve papel OWNER, rótulo e todas as capacidades', async () => {
    const c = await novaConta()
    const { user, membership } = await membro(c, 'OWNER', 'dono@exemplo.test')
    const r = await entrar(c, ' DONO@exemplo.test ', SENHA)
    expect(r.status).toBe(200)
    const corpo = jsonObject(r.json)
    expect(corpo.member).toEqual({ userId: user.id, membershipId: membership.id, name: user.name, role: 'OWNER', professionalId: null })
    expect(corpo.business).toEqual({ id: c.id, slug: c.slug, name: (await prisma.business.findUniqueOrThrow({ where: { id: c.id } })).name })
    const { accessToken, refreshToken } = tokensDe(r.json)
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await verifyAccessToken(accessToken, new Date())).toEqual({
      kind: 'staff',
      businessId: c.id,
      membershipId: membership.id,
      userId: user.id,
    })
    expect(await prisma.refreshToken.count({ where: { membershipId: membership.id, subject: 'MEMBER', revokedAt: null } })).toBe(1)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).not.toBeNull()

    const me = await eu(c, accessToken)
    expect(me.status).toBe(200)
    expect(me.json).toEqual({
      userId: user.id,
      membershipId: membership.id,
      name: user.name,
      email: user.email,
      role: 'OWNER',
      roleLabel: 'Dono',
      professionalId: null,
      capabilities: [...CAPABILITIES],
    })
  })

  test('o gerente não tem manage_account', async () => {
    const c = await novaConta()
    await membro(c, 'MANAGER', 'gerente@exemplo.test')
    const r = await entrar(c, 'gerente@exemplo.test', SENHA)
    const me = jsonObject((await eu(c, tokensDe(r.json).accessToken)).json)
    expect(me.role).toBe('MANAGER')
    expect(me.roleLabel).toBe('Gerente')
    expect(me.capabilities).toEqual(CAPABILITIES.filter((x) => x !== 'manage_account'))
  })

  test('staff/me lista as capacidades dos módulos por nome: dono e gerente têm as quatro, o profissional nenhuma', async () => {
    const c = await novaConta()
    const dosModulos = ['manage_loyalty', 'manage_banners', 'manage_store']
    for (const [role, email] of [['OWNER', 'dono@exemplo.test'], ['MANAGER', 'gerente@exemplo.test'], ['PROFESSIONAL', 'prof@exemplo.test']] as const) {
      await membro(c, role, email)
      const r = await entrar(c, email, SENHA)
      const capabilities = jsonObject((await eu(c, tokensDe(r.json).accessToken)).json).capabilities
      for (const nome of dosModulos) {
        if (role === 'PROFESSIONAL') expect(capabilities).not.toContain(nome)
        else expect(capabilities).toContain(nome)
      }
    }
  })

  test('o profissional tem as 5 básicas, o professionalId ligado e o rótulo com o termo da conta', async () => {
    const c = await novaConta()
    await prisma.businessSettings.update({ where: { businessId: c.id }, data: { termProfessionalSingular: 'Barbeiro' } })
    const { membership } = await membro(c, 'PROFESSIONAL', 'barbeiro@exemplo.test')
    const profissional = await makeProfessional(c.id, { membershipId: membership.id })
    const r = await entrar(c, 'barbeiro@exemplo.test', SENHA)
    expect(jsonObject(r.json).member).toMatchObject({ role: 'PROFESSIONAL', professionalId: profissional.id })
    const me = jsonObject((await eu(c, tokensDe(r.json).accessToken)).json)
    expect(me).toMatchObject({ role: 'PROFESSIONAL', roleLabel: 'Barbeiro', professionalId: profissional.id })
    expect(me.capabilities).toEqual(CAPABILITIES.slice(0, 5))
  })

  test('senha errada, e-mail inexistente, sem vínculo na conta, vínculo desativado e sem senha: a mesma resposta 401', async () => {
    const c = await novaConta()
    const outra = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    // Usuário sem nenhum vínculo ativo (só tinha vínculo antigo, desativado, em outra conta).
    const forasteiro = await membro(outra, 'OWNER', 'forasteiro@exemplo.test')
    await prisma.membership.update({ where: { id: forasteiro.membership.id }, data: { active: false } })
    const inativo = await membro(c, 'MANAGER', 'inativo@exemplo.test')
    await prisma.membership.update({ where: { id: inativo.membership.id }, data: { active: false } })
    const convite = await makeUser({ email: 'convite@exemplo.test', password: null })
    await makeMembership(c.id, convite.id, 'MANAGER')
    const casos = [
      await entrar(c, 'dono@exemplo.test', 'senha-errada-qualquer'),
      await entrar(c, 'ninguem@exemplo.test', SENHA),
      await entrar(c, 'forasteiro@exemplo.test', SENHA),
      await entrar(c, 'inativo@exemplo.test', SENHA),
      await entrar(c, 'convite@exemplo.test', SENHA),
    ]
    for (const r of casos) {
      expect(r.status).toBe(401)
      expect(apiError(r.json)).toMatchObject({ code: 'unauthorized', reason: 'invalid_credentials' })
    }
    expect(new Set(casos.map((r) => r.text)).size).toBe(1)
    expect(await prisma.refreshToken.count()).toBe(0)
  })

  test('vínculo ativo em conta suspensa ou arquivada: 503 business_unavailable só com a senha certa; senha errada segue 401', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      await resetDb()
      const c = await novaConta()
      await membro(c, 'OWNER', 'dono@exemplo.test')
      await prisma.business.update({ where: { id: c.id }, data: { status } })
      const errada = await entrar(c, 'dono@exemplo.test', 'senha-errada-qualquer')
      expect(errada.status).toBe(401)
      expect(apiError(errada.json).reason).toBe('invalid_credentials')
      const certa = await entrar(c, 'dono@exemplo.test', SENHA)
      expect(certa.status).toBe(503)
      expect(apiError(certa.json).code).toBe('business_unavailable')
      expect(await prisma.refreshToken.count()).toBe(0)
    }
  })

  test('a 6ª tentativa do mesmo e-mail e IP é barrada com 429; outro IP não é afetado', async () => {
    const c = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    const ip = '203.0.113.60'
    for (let i = 0; i < 5; i++) expect((await entrar(c, 'dono@exemplo.test', 'errada-errada-1', ip)).status).toBe(401)
    const sexta = await entrar(c, 'dono@exemplo.test', SENHA, ip)
    expect(sexta.status).toBe(429)
    expect(apiError(sexta.json).code).toBe('rate_limited')
    expect((await entrar(c, 'dono@exemplo.test', SENHA, '203.0.113.61')).status).toBe(200)
  })

  test('conta suspensa: entrar e usar o token dão 503 business_unavailable', async () => {
    const c = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    const r = await entrar(c, 'dono@exemplo.test', SENHA)
    const { accessToken } = tokensDe(r.json)
    await prisma.business.update({ where: { id: c.id }, data: { status: 'SUSPENDED' } })
    const me = await eu(c, accessToken)
    expect(me.status).toBe(503)
    expect(apiError(me.json).code).toBe('business_unavailable')
    expect((await entrar(c, 'dono@exemplo.test', SENHA)).status).toBe(503)
  })

  test('o limite por e-mail e IP não depende de loja nem do X-Business enviado', async () => {
    const c = await novaConta()
    const outra = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    const ip = '203.0.113.70'
    for (let i = 0; i < 3; i++) expect((await entrar(c, 'dono@exemplo.test', 'errada-errada-1', ip, c)).status).toBe(401)
    for (let i = 0; i < 2; i++) expect((await entrar(c, 'dono@exemplo.test', 'errada-errada-1', ip, outra)).status).toBe(401)
    expect((await entrar(c, 'dono@exemplo.test', SENHA, ip)).status).toBe(429)
  })
})

describe('sessão da equipe', () => {
  test('vínculo desativado depois do login: 401 na rota seguinte e na renovação', async () => {
    const c = await novaConta()
    const { membership } = await membro(c, 'MANAGER', 'gerente@exemplo.test')
    const r = await entrar(c, 'gerente@exemplo.test', SENHA)
    const { accessToken, refreshToken } = tokensDe(r.json)
    expect((await eu(c, accessToken)).status).toBe(200)
    await prisma.membership.update({ where: { id: membership.id }, data: { active: false } })
    const depois = await eu(c, accessToken)
    expect(depois.status).toBe(401)
    expect(apiError(depois.json)).toMatchObject({ code: 'unauthorized', reason: 'session_invalid' })
    expect((await chamar(refresh, '/refresh', c, { refreshToken })).status).toBe(401)
  })

  test('o papel vem do banco, nunca do token: rebaixar o papel vale na requisição seguinte', async () => {
    const c = await novaConta()
    const { membership } = await membro(c, 'OWNER', 'dono@exemplo.test')
    const { accessToken } = tokensDe((await entrar(c, 'dono@exemplo.test', SENHA)).json)
    await prisma.membership.update({ where: { id: membership.id }, data: { role: 'PROFESSIONAL' } })
    const me = jsonObject((await eu(c, accessToken)).json)
    expect(me.role).toBe('PROFESSIONAL')
    expect(me.capabilities).toEqual(CAPABILITIES.slice(0, 5))
  })

  test('a renovação rotaciona; o reuso derruba a família; sair revoga', async () => {
    const c = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    const primeiro = tokensDe((await entrar(c, 'dono@exemplo.test', SENHA)).json)
    const r1 = await chamar(refresh, '/refresh', c, { refreshToken: primeiro.refreshToken })
    expect(r1.status).toBe(200)
    expect(Object.keys(jsonObject(r1.json))).toEqual(['tokens'])
    const segundo = tokensDe(r1.json)
    expect((await eu(c, segundo.accessToken)).status).toBe(200)
    expect((await chamar(refresh, '/refresh', c, { refreshToken: primeiro.refreshToken })).status).toBe(401)
    expect((await chamar(refresh, '/refresh', c, { refreshToken: segundo.refreshToken })).status).toBe(401)

    const novo = tokensDe((await entrar(c, 'dono@exemplo.test', SENHA)).json)
    const saida = await chamar(logout, '/logout', c, { refreshToken: novo.refreshToken })
    expect(saida.status).toBe(204)
    expect((await chamar(refresh, '/refresh', c, { refreshToken: novo.refreshToken })).status).toBe(401)
    expect((await chamar(logout, '/logout', c, { refreshToken: 'z'.repeat(43) })).status).toBe(204)
  })

  test('token de equipe em rota de cliente: 403; token de cliente em rota de equipe: 403', async () => {
    const c = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    const { accessToken } = tokensDe((await entrar(c, 'dono@exemplo.test', SENHA)).json)
    const naRotaDoCliente = await callRoute(rotaDoCliente, apiRequest('GET', '/v1/teste/cliente-da-tarefa-8', { business: c.slug, token: accessToken }))
    expect(naRotaDoCliente.status).toBe(403)
    expect(apiError(naRotaDoCliente.json).reason).toBe('wrong_token_kind')

    const cliente = await makeCustomer(c.id)
    const par = await tenantDb(c.id).$transaction((tx) => issueTokens(tx, { kind: 'customer', businessId: c.id, customerId: cliente.id }, meta, new Date()))
    const naDaEquipe = await eu(c, par.accessToken)
    expect(naDaEquipe.status).toBe(403)
    expect(apiError(naDaEquipe.json).reason).toBe('wrong_token_kind')
  })

  test('sem token: 401', async () => {
    const c = await novaConta()
    const r = await callRoute(staffMe, apiRequest('GET', '/v1/staff/me', { business: c.slug }))
    expect(r.status).toBe(401)
  })
})

describe('tokens de renovação do outro tipo de sujeito', () => {
  async function umDeCadaTipo() {
    const c = await novaConta()
    await membro(c, 'OWNER', 'dono@exemplo.test')
    const equipe = tokensDe((await entrar(c, 'dono@exemplo.test', SENHA)).json)
    const cliente = await makeCustomer(c.id)
    const par = await tenantDb(c.id).$transaction((tx) =>
      issueTokens(tx, { kind: 'customer', businessId: c.id, customerId: cliente.id }, meta, new Date()),
    )
    return { c, equipe, cliente: { refreshToken: par.refreshToken } }
  }

  test('token de renovação de cliente em /auth/staff/refresh: 401 e a família do cliente continua intacta', async () => {
    const { c, cliente } = await umDeCadaTipo()
    const r = await chamar(refresh, '/refresh', c, { refreshToken: cliente.refreshToken })
    expect(r.status).toBe(401)
    expect(apiError(r.json)).toMatchObject({ code: 'unauthorized', reason: 'invalid_refresh_token' })
    const linha = await prisma.refreshToken.findFirstOrThrow({ where: { subject: 'CUSTOMER' } })
    expect(linha).toMatchObject({ usedAt: null, revokedAt: null })
    expect(await prisma.refreshToken.count({ where: { subject: 'CUSTOMER' } })).toBe(1)
    // O token do cliente ainda renova na rota do cliente.
    const dele = await callRoute(
      customerRefresh,
      apiRequest('POST', '/v1/auth/customer/refresh', { business: c.slug, body: { refreshToken: cliente.refreshToken }, headers: { 'x-forwarded-for': outroIp() } }),
    )
    expect(dele.status).toBe(200)
  })

  test('token de renovação da equipe em /auth/customer/refresh: 401 e a família da equipe continua intacta', async () => {
    const { c, equipe } = await umDeCadaTipo()
    const r = await callRoute(
      customerRefresh,
      apiRequest('POST', '/v1/auth/customer/refresh', { business: c.slug, body: { refreshToken: equipe.refreshToken }, headers: { 'x-forwarded-for': outroIp() } }),
    )
    expect(r.status).toBe(401)
    const linha = await prisma.refreshToken.findFirstOrThrow({ where: { subject: 'MEMBER' } })
    expect(linha).toMatchObject({ usedAt: null, revokedAt: null })
    expect((await chamar(refresh, '/refresh', c, { refreshToken: equipe.refreshToken })).status).toBe(200)
  })

  test('sair com o token do outro tipo não revoga nada', async () => {
    const { c, equipe, cliente } = await umDeCadaTipo()
    expect((await chamar(logout, '/logout', c, { refreshToken: cliente.refreshToken })).status).toBe(204)
    expect(await prisma.refreshToken.count({ where: { subject: 'CUSTOMER', revokedAt: null } })).toBe(1)
    const r = await callRoute(
      customerLogout,
      apiRequest('POST', '/v1/auth/customer/logout', { business: c.slug, body: { refreshToken: equipe.refreshToken }, headers: { 'x-forwarded-for': outroIp() } }),
    )
    expect(r.status).toBe(204)
    expect(await prisma.refreshToken.count({ where: { subject: 'MEMBER', revokedAt: null } })).toBe(1)
  })
})
