import { AuthError } from '@/server/auth/actor'
import { getMemberSession, getTenantContext, loginUser, logoutUser, resetLoginLimiter as resetMembros, selectBusiness } from '@/server/auth/member-auth'
import { getPlatformActor, loginPlatformAdmin, logoutPlatform, resetLoginLimiter as resetPlataforma } from '@/server/auth/platform-auth'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const SENHA = 'senha-bem-longa'
const ERRADA = 'errada-errada'

beforeEach(async () => {
  await resetDb()
  resetMembros()
  resetPlataforma()
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
test('quem tem duas contas escolhe; conta suspensa não aparece', async () => {
  const u = await makeUser({ password: SENHA })
  const [b1, b2, b3] = [await makeBusiness(), await makeBusiness(), await makeBusiness({ status: 'SUSPENDED' })]
  for (const b of [b1, b2, b3]) await makeMembership(b.id, u.id, 'OWNER')
  const { token, session } = await loginUser({ email: u.email, password: SENHA })
  expect(session.activeBusinessId).toBeNull()
  expect(session.memberships.map((m) => m.businessId).sort()).toEqual([b1.id, b2.id].sort())
  expect(await getTenantContext(token)).toBeNull()
  await expect(selectBusiness(token, b3.id)).rejects.toMatchObject({ code: 'no_access' })
  await selectBusiness(token, b2.id)
  const ctx = await getTenantContext(token)
  expect(ctx).toMatchObject({ businessId: b2.id, timeZone: b2.timezone, actor: { kind: 'member', role: 'OWNER', membershipId: expect.any(String) } })
  expect((await getMemberSession(token))?.activeBusinessId).toBe(b2.id)
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
