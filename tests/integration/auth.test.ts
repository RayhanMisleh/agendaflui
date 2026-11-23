import { vi } from 'vitest'
import { AuthError } from '@/server/auth/actor'
import { getMemberSession, getTenantContext, loginUser, logoutUser, selectBusiness } from '@/server/auth/member-auth'
import { getPlatformActor, loginPlatformAdmin, logoutPlatform } from '@/server/auth/platform-auth'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const SENHA = 'senha-bem-longa'
const ERRADA = 'errada-errada'

beforeEach(async () => {
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
  expect(r.session.activeBusinessId).toBe(b.id)
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
test('o login traz no máximo um vínculo: o ativo; vínculo desativado e conta suspensa não contam', async () => {
  const u = await makeUser({ password: SENHA })
  const [b1, b2, b3] = [await makeBusiness(), await makeBusiness(), await makeBusiness({ status: 'SUSPENDED' })]
  await makeMembership(b1.id, u.id, 'OWNER')
  await prisma.membership.create({ data: { businessId: b2.id, userId: u.id, role: 'OWNER', active: false } })
  await prisma.membership.create({ data: { businessId: b3.id, userId: u.id, role: 'OWNER', active: false } })
  const { token, session } = await loginUser({ email: u.email, password: SENHA })
  expect(session.memberships.map((m) => m.businessId)).toEqual([b1.id])
  expect(session.activeBusinessId).toBe(b1.id)
  await expect(selectBusiness(token, b3.id)).rejects.toMatchObject({ code: 'no_access' })
  const ctx = await getTenantContext(token)
  expect(ctx).toMatchObject({ businessId: b1.id, timeZone: b1.timezone, actor: { kind: 'member', role: 'OWNER', membershipId: expect.any(String) } })
  expect((await getMemberSession(token))?.activeBusinessId).toBe(b1.id)
})
test('quem só tem vínculo ativo numa conta suspensa entra sem nenhuma conta', async () => {
  const u = await makeUser({ password: SENHA })
  const suspensa = await makeBusiness({ status: 'SUSPENDED' })
  await makeMembership(suspensa.id, u.id, 'OWNER')
  const { session } = await loginUser({ email: u.email, password: SENHA })
  expect(session.memberships).toEqual([])
})
test('o contexto da conta traz o fuso gravado nela, não o padrão', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness({ timezone: 'America/Manaus' })
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  const ctx = await getTenantContext(token)
  expect(ctx?.timeZone).toBe('America/Manaus')
})
test('convite pendente (sem senha) não entra', async () => {
  const u = await makeUser({ password: null })
  await expect(loginUser({ email: u.email, password: 'qualquer-coisa' })).rejects.toMatchObject({ code: 'invalid_credentials' })
})
test('membro desativado perde o acesso na hora', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  const m = await makeMembership(b.id, u.id, 'MANAGER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  expect(await getTenantContext(token)).not.toBeNull()
  await prisma.membership.update({ where: { id: m.id }, data: { active: false } })
  expect(await getTenantContext(token)).toBeNull()
})
test('papel é relido a cada chamada', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  const m = await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await prisma.membership.update({ where: { id: m.id }, data: { role: 'PROFESSIONAL' } })
  expect(await getTenantContext(token)).toMatchObject({ actor: { role: 'PROFESSIONAL' } })
})
test('conta suspensa depois do login: contexto some', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await prisma.business.update({ where: { id: b.id }, data: { status: 'SUSPENDED' } })
  expect(await getTenantContext(token)).toBeNull()
})
test('sessão vencida devolve null', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
  expect(await getMemberSession(token)).toBeNull()
  expect(await getTenantContext(token)).toBeNull()
})
test('sessão revogada por logoutUser devolve null', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness()
  await makeMembership(b.id, u.id, 'OWNER')
  const { token } = await loginUser({ email: u.email, password: SENHA })
  await logoutUser(token)
  expect(await getMemberSession(token)).toBeNull()
  expect(await getTenantContext(token)).toBeNull()
})
test('token ausente ou desconhecido devolve null', async () => {
  expect(await getMemberSession(undefined)).toBeNull()
  expect(await getTenantContext('invalido')).toBeNull()
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

async function makeAdminAndLogin(): Promise<void> {
  await makePlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
  await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: SENHA })
}

const chavesDeLimite = async (): Promise<string[]> =>
  (await prisma.rateLimitBucket.findMany({ orderBy: { key: 'asc' } })).map((l) => l.key)

test('painel: ao barrar, o erro traz a espera e a mensagem traz os minutos', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'z@x.test', password: ERRADA }).catch(() => {})
  const erro = await loginUser({ email: 'z@x.test', password: ERRADA }).catch((e: unknown) => e)
  expect(erro).toBeInstanceOf(AuthError)
  const e = erro as AuthError
  expect(e.code).toBe('rate_limited')
  expect(e.retryAfterSec).toBeGreaterThanOrEqual(1)
  expect(e.retryAfterSec).toBeLessThanOrEqual(900)
  expect(e.message).toBe(`Muitas tentativas. Tente de novo em ${Math.ceil((e.retryAfterSec ?? 0) / 60)} minutos.`)
})

test('painel: o limite fica no banco, com chave legível, e vale por e-mail normalizado', async () => {
  await loginUser({ email: '  Z@X.Test ', password: ERRADA }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:painel:email-sem-ip:z@x.test'])
  expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'login:painel:email-sem-ip:z@x.test' } })).count).toBe(1)
})

test('painel: sem IP só conta por e-mail; com IP conta também por IP e barra na 21ª tentativa de e-mails diferentes', async () => {
  await loginUser({ email: 'a@x.test', password: ERRADA }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:painel:email-sem-ip:a@x.test'])
  for (let i = 0; i < 20; i++) await loginUser({ email: `u${i}@x.test`, password: ERRADA, ip: '203.0.113.9' }).catch(() => {})
  expect(await chavesDeLimite()).toContain('login:painel:ip:203.0.113.9')
  await expect(loginUser({ email: 'novo@x.test', password: ERRADA, ip: '203.0.113.9' })).rejects.toMatchObject({ code: 'rate_limited' })
  await expect(loginUser({ email: 'novo@x.test', password: ERRADA, ip: '203.0.113.10' })).rejects.toMatchObject({ code: 'invalid_credentials' })
})

test('painel: o sucesso zera só a chave do e-mail, não a do IP', async () => {
  await makeUser({ email: 'a@x.test', password: SENHA })
  await loginUser({ email: 'a@x.test', password: ERRADA, ip: '203.0.113.9' }).catch(() => {})
  await loginUser({ email: 'a@x.test', password: SENHA, ip: '203.0.113.9' })
  expect(await chavesDeLimite()).toEqual(['login:painel:ip:203.0.113.9'])
})

test('painel: o bloqueio sobrevive a um processo novo (módulo recarregado)', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'z@x.test', password: ERRADA }).catch(() => {})
  vi.resetModules()
  const novo = await import('@/server/auth/member-auth')
  const erro = await novo.loginUser({ email: 'z@x.test', password: ERRADA }).catch((e: unknown) => e)
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

test('painel com IP: 5 erros bloqueiam o e-mail a partir daquele IP, mas outro IP entra com a senha certa', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 5; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: '203.0.113.1' }).catch(() => {})
  const barrado = await loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.1' }).catch((e: unknown) => e)
  expect(barrado).toMatchObject({ code: 'rate_limited' })
  expect((barrado as AuthError).retryAfterSec).toBeGreaterThanOrEqual(1)
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.2' })).resolves.toBeDefined()
})

test('painel com IP: o mesmo bloqueio vale para e-mail que não existe (mensagem idêntica)', async () => {
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

test('painel com IP: 30 erros espalhados por IPs diferentes bloqueiam o e-mail para todos', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 30; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: `203.0.113.${i + 10}` }).catch(() => {})
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '198.51.100.99' })).rejects.toMatchObject({ code: 'rate_limited' })
})

test('painel com IP: o sucesso limpa e-mail+IP e e-mail, nunca o IP', async () => {
  await makeUser({ email: 'a@x.test', password: SENHA })
  await loginUser({ email: 'a@x.test', password: ERRADA, ip: '203.0.113.9' }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:painel:email-ip:a@x.test|203.0.113.9', 'login:painel:email:a@x.test', 'login:painel:ip:203.0.113.9'])
  await loginUser({ email: 'a@x.test', password: SENHA, ip: '203.0.113.9' })
  expect(await chavesDeLimite()).toEqual(['login:painel:ip:203.0.113.9'])
})

test('painel com IPv6: endereços do mesmo /64 dividem o limite', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'v6@x.test', password: ERRADA, ip: `2001:db8:0:0::${i + 1}` }).catch(() => {})
  await expect(loginUser({ email: 'v6@x.test', password: ERRADA, ip: '2001:db8::ffff' })).rejects.toMatchObject({ code: 'rate_limited' })
  expect(await chavesDeLimite()).toContain('login:painel:ip:2001:db8:0:0::/64')
})

test('painel com IP: quem já está bloqueado não consome o teto largo; outro IP ainda entra', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 40; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: '203.0.113.1' }).catch(() => {})
  const largo = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'login:painel:email:dono@x.test' } })
  expect(largo.count).toBe(5)
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.2' })).resolves.toBeDefined()
})

test('painel: sem IP e com IP usam contadores de e-mail separados', async () => {
  await makeUser({ email: 'dono@x.test', password: SENHA })
  for (let i = 0; i < 5; i++) await loginUser({ email: 'dono@x.test', password: ERRADA }).catch(() => {})
  expect(await chavesDeLimite()).toEqual(['login:painel:email-sem-ip:dono@x.test'])
  await expect(loginUser({ email: 'dono@x.test', password: ERRADA })).rejects.toMatchObject({ code: 'rate_limited' })
  await expect(loginUser({ email: 'dono@x.test', password: SENHA, ip: '203.0.113.5' })).resolves.toBeDefined()
  await prisma.rateLimitBucket.deleteMany()
  for (let i = 0; i < 5; i++) await loginUser({ email: 'dono@x.test', password: ERRADA, ip: `203.0.113.${i + 20}` }).catch(() => {})
  expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'login:painel:email:dono@x.test' } })).count).toBe(5)
  await expect(loginUser({ email: 'dono@x.test', password: SENHA })).resolves.toBeDefined()
})
