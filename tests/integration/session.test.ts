import { vi } from 'vitest'
import { AuthError } from '@/server/auth/actor'
import { entrar } from '@/app/app/(entrada)/entrar/actions'
import { APP_COOKIE, requireTenant } from '@/server/auth/guards'
import { getPersonSession, getStaffContext, loginWithPassword, logout, openSession, SESSION_MINUTES, setSessionStore } from '@/server/auth/session'
import { getPlatformActor, loginPlatformAdmin, logoutPlatform } from '@/server/auth/platform-auth'
import { redeemSupport, startSupport } from '@/server/auth/support-session'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      if (options['maxAge'] === 0) jar.delete(name)
      else jar.set(name, value)
    },
  }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to })
  },
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

type Entrada = Parameters<typeof loginWithPassword>[0]
/** Entrada por senha com o relógio real (os testes de relógio fixo chamam `loginWithPassword` direto). */
const loginUser = (i: Entrada) => loginWithPassword(i, new Date())

const SENHA = 'senha-bem-longa'
const ERRADA = 'errada-errada'

beforeEach(async () => {
  jar.clear()
  await resetDb()
})

test('admin da plataforma entra e a sessão vale', async () => {
  await makePlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  const { token } = await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  expect((await getPlatformActor(token))?.kind).toBe('platform_admin')
  await logoutPlatform(token)
  expect(await getPlatformActor(token)).toBeNull()
})
test('admin: e-mail com espaços e maiúsculas entra e lastLoginAt é gravado', async () => {
  const a = await makePlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  await loginPlatformAdmin({ email: '  DEV@AgendaFlui.Test ', password: SENHA })
  const depois = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: a.id } })
  expect(depois.lastLoginAt).not.toBeNull()
})
test('admin inativo não entra e sessão antiga deixa de valer', async () => {
  const a = await makePlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  const { token } = await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  await prisma.platformAdmin.update({ where: { id: a.id }, data: { active: false } })
  expect(await getPlatformActor(token)).toBeNull()
  await expect(loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })).rejects.toMatchObject({ code: 'account_inactive' })
})
test('admin: senha errada e e-mail inexistente dão o mesmo erro; sexta tentativa é barrada', async () => {
  await makePlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  await expect(loginPlatformAdmin({ email: 'dev@agendaflui.test', password: ERRADA })).rejects.toMatchObject({ code: 'invalid_credentials' })
  await expect(loginPlatformAdmin({ email: 'nao@x.test', password: ERRADA })).rejects.toMatchObject({ code: 'invalid_credentials' })
  for (let i = 0; i < 4; i++) await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: ERRADA }).catch(() => {})
  await expect(loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })).rejects.toMatchObject({ code: 'rate_limited' })
})
test('e-mail com espaços e maiúsculas entra', async () => {
  const u = await makeUser({ email: 'dono@loja.test', password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const r = await loginUser({ email: '  Dono@Loja.Test ', password: SENHA })
  expect(r.userId).toBe(u.id)
  expect(await getStaffContext(r.token)).toMatchObject({ businessId: b.id })
  const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  expect(depois.lastLoginAt).not.toBeNull()
})
test('senha errada e e-mail inexistente dão o mesmo erro', async () => {
  await makeUser({ email: 'a@x.test', password: SENHA })
  const e1 = await loginUser({ email: 'a@x.test', password: ERRADA }).catch((e: unknown) => e)
  const e2 = await loginUser({ email: 'nao@x.test', password: ERRADA }).catch((e: unknown) => e)
  expect(e1).toBeInstanceOf(AuthError)
  expect(e1).toMatchObject({ code: 'invalid_credentials' })
  expect(e2).toMatchObject({ code: 'invalid_credentials' })
  expect((e1 as Error).message).toBe((e2 as Error).message)
})
test('sexta tentativa em 15 minutos é barrada', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'z@x.test', password: ERRADA }).catch(() => {})
  await expect(loginUser({ email: 'z@x.test', password: ERRADA })).rejects.toMatchObject({ code: 'rate_limited' })
})
test('login bem-sucedido zera o limitador', async () => {
  await makeUser({ email: 'a@x.test', password: SENHA })
  for (let i = 0; i < 4; i++) await loginUser({ email: 'a@x.test', password: ERRADA }).catch(() => {})
  await loginUser({ email: 'a@x.test', password: SENHA })
  for (let i = 0; i < 4; i++) await loginUser({ email: 'a@x.test', password: ERRADA }).catch(() => {})
  await expect(loginUser({ email: 'a@x.test', password: SENHA })).resolves.toBeDefined()
})
test('o contexto da equipe vem do único vínculo ativo; vínculo desativado e conta suspensa não contam', async () => {
  const u = await makeUser({ password: SENHA })
  const [b1, b2, b3] = [await makeBusiness(), await makeBusiness(), await makeBusiness({ status: 'SUSPENDED' })]
  await makeMembership(b1.id, u.id, 'OWNER')
  await prisma.membership.create({ data: { businessId: b2.id, userId: u.id, role: 'OWNER', active: false } })
  await prisma.membership.create({ data: { businessId: b3.id, userId: u.id, role: 'OWNER', active: false } })
  const { token } = await loginUser({ email: u.email, password: SENHA })
  const ctx = await getStaffContext(token)
  expect(ctx).toMatchObject({ businessId: b1.id, timeZone: b1.timezone, actor: { kind: 'member', role: 'OWNER', membershipId: expect.any(String) } })
  expect(await getPersonSession(token)).toMatchObject({ kind: 'person', user: { id: u.id }, customerBusinessId: null })
})
test('entrar com vínculo de equipe leva ao painel e a sessão não guarda a conta', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'MANAGER')
  const form = new FormData()
  form.set('email', u.email)
  form.set('password', SENHA)
  await expect(entrar({ error: null, email: '' }, form)).rejects.toMatchObject({ to: '/painel' })
  const token = jar.get(APP_COOKIE)
  expect(token).toBeDefined()
  const sessao = await prisma.session.findFirstOrThrow({ where: { userId: u.id } })
  expect(sessao.activeBusinessId).toBeNull()
  expect(await getStaffContext(token)).toMatchObject({ businessId: b.id, actor: { kind: 'member', role: 'MANAGER' } })
})
test('pessoa sem loja entra (a sessão nasce; o destino é a tela sem loja)', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await prisma.membership.create({ data: { businessId: b.id, userId: u.id, role: 'OWNER', active: false } })
  const form = new FormData()
  form.set('email', u.email)
  form.set('password', SENHA)
  await expect(entrar({ error: null, email: '' }, form)).rejects.toMatchObject({ to: '/' })
  expect(jar.has(APP_COOKIE)).toBe(true)
  expect(await prisma.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(1)
  expect(await getStaffContext(jar.get(APP_COOKIE))).toBeNull()
})
test('requireTenant: sem sessão vai para /entrar; pessoa sem equipe vai para /', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await prisma.membership.updateMany({ where: { userId: u.id }, data: { active: false } })
  jar.set(APP_COOKIE, token)
  await expect(requireTenant()).rejects.toMatchObject({ to: '/' })
  jar.delete(APP_COOKIE)
  await expect(requireTenant()).rejects.toMatchObject({ to: '/entrar' })
})
test('quem só tem vínculo ativo numa conta suspensa entra e não tem contexto de equipe', async () => {
  const u = await makeUser({ password: SENHA })
  const suspensa = await makeBusiness({ status: 'SUSPENDED' })
  await makeMembership(suspensa.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  expect(await getStaffContext(token)).toBeNull()
})
test('o contexto da conta traz o fuso gravado nela, não o padrão', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness({ timezone: 'America/Manaus' })
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  const ctx = await getStaffContext(token)
  expect(ctx?.timeZone).toBe('America/Manaus')
})
test('conta pendente não entra por senha', async () => {
  const u = await makeUser({ password: null })
  await expect(loginUser({ email: u.email, password: 'qualquer-coisa' })).rejects.toMatchObject({ code: 'invalid_credentials' })
})
test('membro desativado perde o acesso na hora', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  const m = await makeMembership(b.id, u.id, 'MANAGER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  expect(await getStaffContext(token)).not.toBeNull()
  await prisma.membership.update({ where: { id: m.id }, data: { active: false } })
  expect(await getStaffContext(token)).toBeNull()
})
test('papel é relido a cada chamada', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  const m = await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await prisma.membership.update({ where: { id: m.id }, data: { role: 'PROFESSIONAL' } })
  expect(await getStaffContext(token)).toMatchObject({ actor: { role: 'PROFESSIONAL' } })
})
test('conta suspensa depois do login: contexto some', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await prisma.business.update({ where: { id: b.id }, data: { status: 'SUSPENDED' } })
  expect(await getStaffContext(token)).toBeNull()
})
test('sessão vencida devolve null', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
  expect(await getPersonSession(token)).toBeNull()
  expect(await getStaffContext(token)).toBeNull()
})
test('sessão revogada por logoutUser devolve null', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await logout(token)
  expect(await getPersonSession(token)).toBeNull()
  expect(await getStaffContext(token)).toBeNull()
})
test('token ausente ou desconhecido devolve null', async () => {
  expect(await getPersonSession(undefined)).toBeNull()
  expect(await getStaffContext('invalido')).toBeNull()
  expect(await getPlatformActor(undefined)).toBeNull()
})
test('o banco guarda só o hash do token', async () => {
  const u = await makeUser({ password: SENHA })
  await makeAdminAndLogin()
  const { token } = await loginUser({ email: u.email, password: SENHA })
  const linhas = await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM sessions')
  const platform = await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM platform_sessions')
  expect(JSON.stringify([linhas, platform])).not.toContain(token)
  expect(JSON.stringify(linhas)).toContain(hashToken(token))
})

test('sessão vale 30 dias', async () => {
  const u = await makeUser({ password: SENHA })
  const agora = new Date('2026-11-23T12:00:00.000Z')
  const r = await loginWithPassword({ email: u.email, password: SENHA }, agora)
  expect(SESSION_MINUTES).toBe(30 * 24 * 60)
  expect(r.expiresAt).toEqual(new Date('2026-12-23T12:00:00.000Z'))
  expect(await getPersonSession(r.token, new Date('2026-12-23T11:59:00.000Z'))).not.toBeNull()
  expect(await getPersonSession(r.token, new Date('2026-12-23T12:00:01.000Z'))).toBeNull()
})
test('entrar num aparelho não derruba a sessão do outro', async () => {
  const u = await makeUser({ password: SENHA })
  const a = await loginUser({ email: u.email, password: SENHA })
  const b = await loginUser({ email: u.email, password: SENHA })
  expect(await getPersonSession(a.token)).not.toBeNull()
  expect(await getPersonSession(b.token)).not.toBeNull()
})
test('login revoga só a sessão anterior deste navegador', async () => {
  const u = await makeUser({ password: SENHA })
  const outroAparelho = await loginUser({ email: u.email, password: SENHA })
  const esteNavegador = await loginUser({ email: u.email, password: SENHA })
  const novo = await loginUser({ email: u.email, password: SENHA, previousToken: esteNavegador.token })
  expect(await getPersonSession(esteNavegador.token)).toBeNull()
  expect(await getPersonSession(outroAparelho.token)).not.toBeNull()
  expect(await getPersonSession(novo.token)).not.toBeNull()
})
test('openSession grava a última loja usada e setSessionStore a troca', async () => {
  const u = await makeUser({ password: SENHA })
  const [a, b] = [await makeBusiness(), await makeBusiness()]
  const { token } = await prisma.$transaction((tx) => openSession(tx, { userId: u.id, now: new Date(), customerBusinessId: a.id }))
  expect(await getPersonSession(token)).toMatchObject({ kind: 'person', customerBusinessId: a.id })
  await setSessionStore(token, b.id)
  expect(await getPersonSession(token)).toMatchObject({ customerBusinessId: b.id })
})
test('suporte entra como hoje e o contexto é da conta da sessão', async () => {
  const admin = await makePlatformAdmin()
  const b = await makeBusiness()
  const { url } = await startSupport({ kind: 'platform_admin', adminId: admin.id, name: admin.name }, b.id)
  const r = await redeemSupport(url.split('/').pop() ?? '', {}, new Date())
  expect(r).not.toBeNull()
  expect(await getStaffContext(r?.sessionToken)).toMatchObject({ businessId: b.id, actor: { kind: 'impersonator' } })
  expect(await getPersonSession(r?.sessionToken)).toMatchObject({ kind: 'support', activeBusinessId: b.id })
})

async function makeAdminAndLogin(): Promise<void> {
  await makePlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
}

const chavesDeLimite = async (): Promise<string[]> =>
  (await prisma.rateLimitBucket.findMany({ orderBy: { key: 'asc' } })).map((l) => l.key)

test('entrada: ao barrar, o erro traz a espera e a mensagem traz os minutos', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'z@x.test', password: ERRADA }).catch(() => {})
  const erro = await loginUser({ email: 'z@x.test', password: ERRADA }).catch((e: unknown) => e)
  expect(erro).toBeInstanceOf(AuthError)
  const e = erro as AuthError
  expect(e.code).toBe('rate_limited')
  expect(e.retryAfterSec).toBeGreaterThanOrEqual(1)
  expect(e.retryAfterSec).toBeLessThanOrEqual(900)
  expect(e.message).toBe(`Muitas tentativas. Tente de novo em ${Math.ceil((e.retryAfterSec ?? 0) / 60)} minutos.`)
})

test('entrada: o limite fica no banco, com chave legível, e vale por e-mail normalizado', async () => {
  await loginUser({ email: '  Z@X.Test ', password: ERRADA }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:app:email-sem-ip:z@x.test'])
  expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'login:app:email-sem-ip:z@x.test' } })).count).toBe(1)
})

test('entrada: sem IP só conta por e-mail; com IP conta também por IP e barra na 21ª tentativa de e-mails diferentes', async () => {
  await loginUser({ email: 'a@x.test', password: ERRADA }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:app:email-sem-ip:a@x.test'])
  for (let i = 0; i < 20; i++) await loginUser({ email: `u${i}@x.test`, password: ERRADA, ip: '203.0.113.9' }).catch(() => {})
  expect(await chavesDeLimite()).toContain('login:app:ip:203.0.113.9')
  await expect(loginUser({ email: 'novo@x.test', password: ERRADA, ip: '203.0.113.9' })).rejects.toMatchObject({ code: 'rate_limited' })
  await expect(loginUser({ email: 'novo@x.test', password: ERRADA, ip: '203.0.113.10' })).rejects.toMatchObject({ code: 'invalid_credentials' })
})

test('entrada: o sucesso zera só a chave do e-mail, não a do IP', async () => {
  await makeUser({ email: 'a@x.test', password: SENHA })
  await loginUser({ email: 'a@x.test', password: ERRADA, ip: '203.0.113.9' }).catch(() => {})
  await loginUser({ email: 'a@x.test', password: SENHA, ip: '203.0.113.9' })
  expect(await chavesDeLimite()).toEqual(['login:app:ip:203.0.113.9'])
})

test('entrada: o bloqueio sobrevive a um processo novo (módulo recarregado)', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'z@x.test', password: ERRADA }).catch(() => {})
  vi.resetModules()
  const novo = await import('@/server/auth/session')
  const erro = await novo.loginWithPassword({ email: 'z@x.test', password: ERRADA }, new Date()).catch((e: unknown) => e)
  expect(erro).toMatchObject({ name: 'AuthError', code: 'rate_limited' })
})

test('admin: usa o banco com chaves próprias, barra com minutos e o sucesso zera o e-mail', async () => {
  await makePlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  for (let i = 0; i < 5; i++) await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: ERRADA, ip: '198.51.100.7' }).catch(() => {})
  expect(await chavesDeLimite()).toEqual([
    'login:dev:email-ip:dev@agendaflui.test|198.51.100.7',
    'login:dev:email:dev@agendaflui.test',
    'login:dev:ip:198.51.100.7',
  ])
  const erro = await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA, ip: '198.51.100.7' }).catch((e: unknown) => e)
  expect(erro).toMatchObject({ code: 'rate_limited' })
  expect((erro as AuthError).retryAfterSec).toBeGreaterThanOrEqual(1)
  expect((erro as AuthError).message).toMatch(/Tente de novo em \d+ minutos\./)
  await prisma.rateLimitBucket.deleteMany()
  for (let i = 0; i < 2; i++) await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: ERRADA }).catch(() => {})
  await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  expect(await chavesDeLimite()).toEqual([])
})

test('entrada com IP: 5 erros bloqueiam o e-mail a partir daquele IP, mas outro IP entra com a senha certa', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 5; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: '203.0.113.1' }).catch(() => {})
  const barrado = await loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.1' }).catch((e: unknown) => e)
  expect(barrado).toMatchObject({ code: 'rate_limited' })
  expect((barrado as AuthError).retryAfterSec).toBeGreaterThanOrEqual(1)
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.2' })).resolves.toBeDefined()
})

test('entrada com IP: o mesmo bloqueio vale para e-mail que não existe (mensagem idêntica)', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  const falha = async (email: string): Promise<AuthError> => {
    for (let i = 0; i < 5; i++) await loginUser({ email, password: ERRADA, ip: '203.0.113.1' }).catch(() => {})
    return (await loginUser({ email, password: ERRADA, ip: '203.0.113.1' }).catch((e: unknown) => e)) as AuthError
  }
  const a = await falha('dono@x.test')
  const b = await falha('fantasma@x.test')
  expect(a.code).toBe('rate_limited')
  expect(b.code).toBe('rate_limited')
  expect(a.message).toBe(b.message)
})

test('entrada com IP: 30 erros espalhados por IPs diferentes bloqueiam o e-mail para todos', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 30; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: `203.0.113.${i + 10}` }).catch(() => {})
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '198.51.100.99' })).rejects.toMatchObject({ code: 'rate_limited' })
})

test('entrada com IP: o sucesso limpa e-mail+IP e e-mail, nunca o IP', async () => {
  await makeUser({ email: 'a@x.test', password: SENHA })
  await loginUser({ email: 'a@x.test', password: ERRADA, ip: '203.0.113.9' }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:app:email-ip:a@x.test|203.0.113.9', 'login:app:email:a@x.test', 'login:app:ip:203.0.113.9'])
  await loginUser({ email: 'a@x.test', password: SENHA, ip: '203.0.113.9' })
  expect(await chavesDeLimite()).toEqual(['login:app:ip:203.0.113.9'])
})

test('entrada com IPv6: endereços do mesmo /64 dividem o limite', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'v6@x.test', password: ERRADA, ip: `2001:db8:0:0::${i + 1}` }).catch(() => {})
  await expect(loginUser({ email: 'v6@x.test', password: ERRADA, ip: '2001:db8::ffff' })).rejects.toMatchObject({ code: 'rate_limited' })
  expect(await chavesDeLimite()).toContain('login:app:ip:2001:db8:0:0::/64')
})

test('entrada com IP: quem já está bloqueado não consome o teto largo; outro IP ainda entra', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 40; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: '203.0.113.1' }).catch(() => {})
  const largo = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'login:app:email:dono@x.test' } })
  expect(largo.count).toBe(5)
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.2' })).resolves.toBeDefined()
})

test('entrada: sem IP e com IP usam contadores de e-mail separados', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 5; i++) await loginUser({ email: 'dono@x.test', password: ERRADA }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:app:email-sem-ip:dono@x.test'])
  await expect(loginUser({ email: 'dono@x.test', password: ERRADA })).rejects.toMatchObject({ code: 'rate_limited' })
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.5' })).resolves.toBeDefined()
  await prisma.rateLimitBucket.deleteMany()
  for (let i = 0; i < 5; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: `203.0.113.${i + 20}` }).catch(() => {})
  expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'login:app:email:dono@x.test' } })).count).toBe(5)
  await expect(loginUser({ email: 'dono@x.test', password: SENHA })).resolves.toBeDefined()
})
