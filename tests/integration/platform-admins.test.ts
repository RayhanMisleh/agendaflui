import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { AuthError } from '@/server/auth/actor'
import { loginPlatformAdmin } from '@/server/auth/platform-auth'
import { verifyPassword } from '@/server/auth/password'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import {
  changeOwnPassword,
  createAdmin,
  listAdmins,
  setAdminActive,
  updateOwnProfile,
} from '@/server/domain/platform/admins'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  },
}))

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const AGORA = new Date('2026-11-16T12:00:00.000Z')
const SENHA = 'senha-atual-bem-longa'
let admin: Awaited<ReturnType<typeof makePlatformAdmin>>
let actor: PlatformAdminActor

const comoAtor = (a: { id: string; name: string }): PlatformAdminActor => ({ kind: 'platform_admin', adminId: a.id, name: a.name })

beforeEach(async () => {
  await resetDb()
  admin = await makePlatformAdmin({ name: 'Ana Admin', email: 'ana@exemplo.test', password: SENHA })
  actor = comoAtor(admin)
})

async function sessaoDoAdmin(adminId: string) {
  const token = randomUUID()
  await prisma.platformSession.create({ data: { adminId, tokenHash: hashToken(token), expiresAt: addMinutes(AGORA, 600) } })
  return token
}

async function sessaoDeSuporte(adminId: string, businessId: string) {
  return prisma.session.create({
    data: { impersonatorAdminId: adminId, activeBusinessId: businessId, tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 60) },
  })
}

const revogada = async (token: string) =>
  (await prisma.platformSession.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } })).revokedAt !== null

describe('createAdmin e listAdmins', () => {
  test('cria o admin com senha argon2, e-mail em minúsculas, e audita sem a senha', async () => {
    const r = await createAdmin(actor, { name: ' Beto Admin ', email: 'Beto@Exemplo.test', password: 'uma-senha-de-beto-1' })
    expect(r).toMatchObject({ name: 'Beto Admin', email: 'beto@exemplo.test', active: true, lastLoginAt: null })
    const linha = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: r.id } })
    expect(linha.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(linha.passwordHash, 'uma-senha-de-beto-1')).toBe(true)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.created' } })
    expect(log).toMatchObject({ businessId: null, actorType: 'PLATFORM_ADMIN', actorId: admin.id, actorName: 'Ana Admin', targetId: r.id })
    expect(JSON.stringify(log)).not.toContain('uma-senha-de-beto-1')
    expect(JSON.stringify(log)).not.toContain(linha.passwordHash)
    expect((await listAdmins(actor)).map((a) => a.email)).toEqual(['ana@exemplo.test', 'beto@exemplo.test'])
  })

  test('e-mail repetido (mesmo em maiúsculas) falha por campo; senha curta também', async () => {
    const e = await domainError(createAdmin(actor, { name: 'Outra', email: 'ANA@exemplo.test', password: 'uma-senha-de-beto-1' }))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {})).toEqual(['email'])
    const curta = await domainError(createAdmin(actor, { name: 'Outra', email: 'o@exemplo.test', password: 'curta' }))
    expect(Object.keys(curta.fields ?? {})).toEqual(['password'])
    expect(await prisma.platformAdmin.count()).toBe(1)
  })

  test('dois cadastros simultâneos do mesmo e-mail: um passa', async () => {
    const criar = () => createAdmin(actor, { name: 'Beto', email: 'beto@exemplo.test', password: 'uma-senha-de-beto-1' })
    const r = await Promise.allSettled([criar(), criar()])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.platformAdmin.count({ where: { email: 'beto@exemplo.test' } })).toBe(1)
  })
})

describe('setAdminActive', () => {
  test('desativar derruba as sessões do admin e as de suporte abertas por ele; reativar não as devolve', async () => {
    const outro = await makePlatformAdmin()
    const conta = await makeBusiness()
    const t1 = await sessaoDoAdmin(outro.id)
    const t2 = await sessaoDoAdmin(outro.id)
    const minha = await sessaoDoAdmin(admin.id)
    const suporte = await sessaoDeSuporte(outro.id, conta.id)
    const suporteMeu = await sessaoDeSuporte(admin.id, conta.id)

    const r = await setAdminActive(actor, outro.id, false)
    expect(r.active).toBe(false)
    expect(await revogada(t1)).toBe(true)
    expect(await revogada(t2)).toBe(true)
    expect(await revogada(minha)).toBe(false)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: suporte.id } })).revokedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: suporteMeu.id } })).revokedAt).toBeNull()
    expect(await prisma.auditLog.count({ where: { action: 'admin.deactivated', targetId: outro.id, actorId: admin.id } })).toBe(1)

    const volta = await setAdminActive(actor, outro.id, true)
    expect(volta.active).toBe(true)
    expect(await revogada(t1)).toBe(true)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: suporte.id } })).revokedAt).not.toBeNull()
    expect(await prisma.auditLog.count({ where: { action: 'admin.activated', targetId: outro.id } })).toBe(1)
  })

  test('não se pode desativar a si mesmo', async () => {
    await makePlatformAdmin()
    const e = await domainError(setAdminActive(actor, admin.id, false))
    expect(e.code).toBe('conflict')
    expect(e.message).toMatch(/outro admin/i)
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })).active).toBe(true)
  })

  test('o último admin ativo não é desativado: nem por si mesmo, nem por um ator que já foi desativado', async () => {
    const outro = await makePlatformAdmin()
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { active: false } })
    expect((await domainError(setAdminActive(actor, outro.id, false))).code).toBe('forbidden')
    expect((await domainError(setAdminActive(comoAtor(outro), outro.id, false))).code).toBe('conflict')
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: outro.id } })).active).toBe(true)
  })

  test('duas desativações simultâneas dos dois últimos admins: só uma passa', async () => {
    const outro = await makePlatformAdmin()
    const r = await Promise.allSettled([setAdminActive(actor, outro.id, false), setAdminActive(comoAtor(outro), admin.id, false)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.platformAdmin.count({ where: { active: true } })).toBe(1)
  })

  test('admin que não existe: not_found', async () => {
    expect((await domainError(setAdminActive(actor, randomUUID(), false))).code).toBe('not_found')
    expect((await domainError(setAdminActive(actor, 'x', false))).code).toBe('not_found')
  })
})

describe('updateOwnProfile', () => {
  test('troca o nome do próprio admin e audita', async () => {
    const r = await updateOwnProfile(actor, { name: '  Ana Maria  ' })
    expect(r.name).toBe('Ana Maria')
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })).name).toBe('Ana Maria')
    expect(await prisma.auditLog.count({ where: { action: 'admin.profile_updated', targetId: admin.id } })).toBe(1)
    expect((await domainError(updateOwnProfile(actor, { name: ' ' }))).code).toBe('validation')
  })
})

describe('changeOwnPassword', () => {
  const NOVA = 'outra-senha-bem-longa-2'

  test('senha atual errada falha por campo, sem trocar nada; a 6ª tentativa dentro de 15 min bloqueia', async () => {
    const antes = (await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash
    const tok = await sessaoDoAdmin(admin.id)
    for (let i = 1; i <= 5; i++) {
      const e = await domainError(changeOwnPassword(actor, { current: 'senha-errada-qualquer', next: NOVA }, tok))
      expect(e.reason).toBe('wrong_password')
      expect(Object.keys(e.fields ?? {})).toEqual(['current'])
    }
    await expect(changeOwnPassword(actor, { current: SENHA, next: NOVA }, tok)).rejects.toMatchObject({ name: 'AuthError', code: 'rate_limited' })
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(antes)
    expect(await revogada(tok)).toBe(false)
  })

  test('com a senha certa: troca o hash, revoga as outras sessões (inclusive de suporte) e mantém a atual', async () => {
    const atual = await sessaoDoAdmin(admin.id)
    const outra = await sessaoDoAdmin(admin.id)
    const conta = await makeBusiness()
    const suporte = await sessaoDeSuporte(admin.id, conta.id)
    const alheia = await sessaoDoAdmin((await makePlatformAdmin()).id)

    await changeOwnPassword(actor, { current: SENHA, next: NOVA }, atual)
    const linha = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })
    expect(linha.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(linha.passwordHash, NOVA)).toBe(true)
    expect(await verifyPassword(linha.passwordHash, SENHA)).toBe(false)
    expect(await revogada(atual)).toBe(false)
    expect(await revogada(outra)).toBe(true)
    expect(await revogada(alheia)).toBe(false)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: suporte.id } })).revokedAt).not.toBeNull()
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.password_changed' } })
    expect(log).toMatchObject({ actorId: admin.id, targetId: admin.id })
    expect(JSON.stringify(log)).not.toContain(NOVA)
    expect(JSON.stringify(log)).not.toContain(SENHA)
  })

  test('senha nova curta ou igual à atual é recusada sem gastar a troca', async () => {
    const tok = await sessaoDoAdmin(admin.id)
    expect(Object.keys((await domainError(changeOwnPassword(actor, { current: SENHA, next: 'curta' }, tok))).fields ?? {})).toEqual(['next'])
    expect(Object.keys((await domainError(changeOwnPassword(actor, { current: SENHA, next: SENHA }, tok))).fields ?? {})).toEqual(['next'])
  })

  test('acertar limpa o contador: depois de uma troca certa, errar de novo recomeça em 1', async () => {
    const tok = await sessaoDoAdmin(admin.id)
    for (let i = 0; i < 4; i++) await domainError(changeOwnPassword(actor, { current: 'errada-errada-1', next: NOVA }, tok))
    await changeOwnPassword(actor, { current: SENHA, next: NOVA }, tok)
    for (let i = 0; i < 5; i++) expect((await domainError(changeOwnPassword(actor, { current: 'errada-errada-1', next: SENHA }, tok))).reason).toBe('wrong_password')
  })
})

describe('autorização', () => {
  test('quem não é admin, ou admin que não existe mais, recebe forbidden em toda função', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    const fantasma: PlatformAdminActor = { kind: 'platform_admin', adminId: randomUUID(), name: 'x' }
    for (const quem of [intruso, fantasma]) {
      const chamadas = [
        () => listAdmins(quem),
        () => createAdmin(quem, { name: 'B', email: 'b@exemplo.test', password: 'uma-senha-de-beto-1' }),
        () => setAdminActive(quem, admin.id, false),
        () => updateOwnProfile(quem, { name: 'Novo' }),
        () => changeOwnPassword(quem, { current: SENHA, next: 'outra-senha-bem-longa-2' }, 'tok'),
      ]
      for (const c of chamadas) expect((await domainError(c())).code).toBe('forbidden')
    }
    expect(await prisma.platformAdmin.count()).toBe(1)
  })
})

describe('entrada do admin (pendências da Fase 1)', () => {
  test('só o hash do token da sessão fica no banco', async () => {
    const { token } = await loginPlatformAdmin({ email: 'ana@exemplo.test', password: SENHA, ip: '203.0.113.9' })
    const sessao = await prisma.platformSession.findFirstOrThrow({ where: { adminId: admin.id } })
    expect(sessao.tokenHash).toBe(hashToken(token))
    expect(sessao.tokenHash).not.toBe(token)
    const tudo = JSON.stringify(await prisma.$queryRaw`SELECT to_jsonb(t) AS j FROM platform_sessions t`)
    expect(tudo).not.toContain(token)
  })

  test('e-mail em maiúsculas ou com espaços não contorna o limite de tentativas', async () => {
    const variantes = ['ana@exemplo.test', 'ANA@exemplo.test', ' Ana@Exemplo.test', 'aNa@EXEMPLO.test', 'ana@exemplo.test']
    for (const email of variantes) {
      await expect(loginPlatformAdmin({ email, password: 'errada-errada-1', ip: '203.0.113.9' })).rejects.toMatchObject({ code: 'invalid_credentials' })
    }
    await expect(loginPlatformAdmin({ email: 'ANA@EXEMPLO.TEST', password: SENHA, ip: '203.0.113.9' })).rejects.toBeInstanceOf(AuthError)
    await expect(loginPlatformAdmin({ email: 'ANA@EXEMPLO.TEST', password: SENHA, ip: '203.0.113.9' })).rejects.toMatchObject({ code: 'rate_limited' })
  })

  test('um novo login no mesmo navegador revoga a sessão anterior daquele cookie, e só ela', async () => {
    const anterior = await sessaoDoAdmin(admin.id)
    const outroNavegador = await sessaoDoAdmin(admin.id)
    const { token } = await loginPlatformAdmin({ email: 'ana@exemplo.test', password: SENHA, ip: '203.0.113.9', previousToken: anterior })
    expect(await revogada(anterior)).toBe(true)
    expect(await revogada(outroNavegador)).toBe(false)
    expect(await revogada(token)).toBe(false)
  })
})
