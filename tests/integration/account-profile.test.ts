import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import type { Actor, TenantContext } from '@/server/auth/actor'
import { verifyPassword } from '@/server/auth/password'
import { hashToken } from '@/server/auth/tokens'
import { publicUsers } from '@/server/auth/user-public'
import { prisma } from '@/server/db/client'
import { changeOwnAccountPassword, getOwnAccountProfile, updateOwnAccountProfile } from '@/server/domain/account/profile'
import { sendAccessPasswordReset } from '@/server/domain/team/access'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeMembership, makePlatformAdmin, makeProfessional, makeUpload, makeUser, memberOf } from '../setup/factories'

const AGORA = new Date('2026-11-17T12:00:00.000Z')
const SENHA = 'senha-atual-bem-longa'
let businessId: string
let ctx: TenantContext
let userId: string

beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ name: 'Barbearia Central' })).id
  const user = await makeUser({ name: 'Rita Prado', email: 'rita@exemplo.test', password: SENHA })
  const membership = await makeMembership(businessId, user.id, 'MANAGER')
  userId = user.id
  ctx = await makeCtx(
    { id: businessId },
    { now: AGORA, actor: { kind: 'member', userId: user.id, membershipId: membership.id, name: user.name, role: 'MANAGER' } },
  )
})

const sessao = (token: string, uid = userId) =>
  prisma.session.create({ data: { userId: uid, activeBusinessId: businessId, tokenHash: hashToken(token), expiresAt: addMinutes(AGORA, 600) } })

const refresh = (membershipId: string, b = businessId) =>
  prisma.refreshToken.create({
    data: { businessId: b, subject: 'MEMBER', membershipId, familyId: randomUUID(), tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600) },
  })

describe('getOwnAccountProfile', () => {
  test('devolve nome, e-mail, papel, ficha de profissional e a foto pelo ajudante de URL do painel', async () => {
    const upload = await makeUpload(null)
    await prisma.user.update({ where: { id: userId }, data: { avatarUploadId: upload.id } })
    const ficha = await makeProfessional(businessId, { membershipId: memberOf(ctx).membershipId })
    expect(await getOwnAccountProfile(ctx)).toEqual({
      name: 'Rita Prado',
      email: 'rita@exemplo.test',
      avatarUrl: `/arquivos/${upload.path}`,
      role: 'MANAGER',
      professionalId: ficha.id,
    })
  })

  test('sem foto e sem ficha: nulos; ficha arquivada não conta', async () => {
    await makeProfessional(businessId, { membershipId: memberOf(ctx).membershipId, archivedAt: AGORA })
    expect(await getOwnAccountProfile(ctx)).toMatchObject({ avatarUrl: null, professionalId: null })
  })
})

describe('updateOwnAccountProfile', () => {
  test('troca o nome, regrava a busca sem acento e audita; nome vazio ou grande demais é validação', async () => {
    await updateOwnAccountProfile(ctx, { name: '  Rita Çardoso  ' })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ name: 'Rita Çardoso', searchName: 'rita cardoso' })
    expect(await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'account.profile_updated' } })).toMatchObject({
      actorType: 'USER',
      actorId: userId,
      targetId: userId,
    })
    for (const name of ['  ', 'x'.repeat(121)]) {
      const e = await domainError(updateOwnAccountProfile(ctx, { name }))
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty('name')
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe('Rita Çardoso')
  })
})

describe('changeOwnAccountPassword', () => {
  test('com a senha certa mantém só a sessão do token passado e derruba as outras sessões e os tokens do app de todos os vínculos', async () => {
    const outra = (await makeBusiness()).id
    const segundo = await makeMembership(outra, userId, 'PROFESSIONAL')
    const atual = await sessao('token-atual')
    const outraSessao = await sessao('token-outro-aparelho')
    const tokenAqui = await refresh(memberOf(ctx).membershipId)
    const tokenOutra = await refresh(segundo.id, outra)
    const colega = await makeUser()
    const mColega = await makeMembership(businessId, colega.id, 'PROFESSIONAL')
    const sessaoColega = await sessao('token-colega', colega.id)
    const tokenColega = await refresh(mColega.id)

    await changeOwnAccountPassword(ctx, { current: SENHA, next: 'senha-nova-bem-longa' }, 'token-atual')

    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash ?? ''
    expect(await verifyPassword(hash, 'senha-nova-bem-longa')).toBe(true)
    expect(hash).not.toContain('senha-nova')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: atual.id } })).revokedAt).toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: outraSessao.id } })).revokedAt).not.toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: tokenAqui.id } })).revokedAt).not.toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: tokenOutra.id } })).revokedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoColega.id } })).revokedAt).toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: tokenColega.id } })).revokedAt).toBeNull()
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'account.password_changed' } })
    expect(JSON.stringify(log)).not.toContain('senha-nova')
  })

  test('senha atual errada é recusada sem mudar nada; na 6ª tentativa a pessoa é barrada até com a senha certa', async () => {
    await sessao('token-atual')
    for (let i = 0; i < 5; i++) {
      const e = await domainError(changeOwnAccountPassword(ctx, { current: 'errada-errada-1', next: 'senha-nova-bem-longa' }, 'token-atual'))
      expect(e.code).toBe('forbidden')
      expect(e.reason).toBe('wrong_password')
    }
    await expect(changeOwnAccountPassword(ctx, { current: SENHA, next: 'senha-nova-bem-longa' }, 'token-atual')).rejects.toMatchObject({
      code: 'rate_limited',
    })
    expect(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash ?? '', SENHA)).toBe(true)
  })

  test('acertar limpa o contador; o teto é por usuário, não por conta', async () => {
    for (let i = 0; i < 4; i++) await domainError(changeOwnAccountPassword(ctx, { current: 'errada-errada-1', next: 'senha-nova-bem-longa' }, 'x'))
    await changeOwnAccountPassword(ctx, { current: SENHA, next: 'senha-nova-bem-longa' }, 'x')
    for (let i = 0; i < 4; i++) await domainError(changeOwnAccountPassword(ctx, { current: 'errada-errada-1', next: 'outra-senha-bem-longa' }, 'x'))
    await changeOwnAccountPassword(ctx, { current: 'senha-nova-bem-longa', next: 'outra-senha-bem-longa' }, 'x')
    const outro = await ctxWithRole({ id: businessId }, 'MANAGER', { now: AGORA })
    const e = await domainError(changeOwnAccountPassword(outro, { current: 'errada-errada-1', next: 'senha-nova-bem-longa' }, 'x'))
    expect(e.reason).toBe('wrong_password')
  })

  test('nova senha igual à atual, curta ou vazia é validação por campo e nada muda', async () => {
    const igual = await domainError(changeOwnAccountPassword(ctx, { current: SENHA, next: SENHA }, 't'))
    expect(igual.code).toBe('validation')
    expect(igual.fields).toHaveProperty('next')
    const curta = await domainError(changeOwnAccountPassword(ctx, { current: SENHA, next: 'curta' }, 't'))
    expect(curta.fields).toHaveProperty('next')
    const vazia = await domainError(changeOwnAccountPassword(ctx, { current: '', next: 'senha-nova-bem-longa' }, 't'))
    expect(vazia.fields).toHaveProperty('current')
    expect(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash ?? '', SENHA)).toBe(true)
  })

  test('usuário sem senha ainda (convite pendente) não troca senha por aqui', async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } })
    expect((await domainError(changeOwnAccountPassword(ctx, { current: SENHA, next: 'senha-nova-bem-longa' }, 't'))).reason).toBe('wrong_password')
  })
})

describe('ator de suporte e demais atores não têm "eu"', () => {
  test('suporte recebe forbidden em perfil, nome, senha e redefinição; nada muda', async () => {
    const admin = await makePlatformAdmin()
    const suporte = await makeCtx({ id: businessId }, { now: AGORA, actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } })
    const alvo = await makeUser()
    const m = await makeMembership(businessId, alvo.id, 'PROFESSIONAL')
    const chamadas = [
      () => getOwnAccountProfile(suporte),
      () => updateOwnAccountProfile(suporte, { name: 'Outro' }),
      () => changeOwnAccountPassword(suporte, { current: SENHA, next: 'senha-nova-bem-longa' }, 't'),
      () => sendAccessPasswordReset(suporte, m.id),
    ]
    for (const c of chamadas) expect((await domainError(c())).code).toBe('forbidden')
    expect(await prisma.userToken.count()).toBe(0)
    expect(await prisma.rateLimitBucket.count()).toBe(0)
  })

  test('cliente, visitante, sistema e admin da plataforma também recebem forbidden', async () => {
    const atores: Actor[] = [
      { kind: 'customer', customerId: randomUUID(), name: 'Cli' },
      { kind: 'guest' },
      { kind: 'system' },
      { kind: 'platform_admin', adminId: randomUUID(), name: 'Ana' },
    ]
    for (const actor of atores) {
      const c = { ...ctx, actor }
      expect((await domainError(getOwnAccountProfile(c))).code).toBe('forbidden')
      expect((await domainError(updateOwnAccountProfile(c, { name: 'X' }))).code).toBe('forbidden')
      expect((await domainError(changeOwnAccountPassword(c, { current: SENHA, next: 'senha-nova-bem-longa' }, 't'))).code).toBe('forbidden')
    }
  })
})

describe('publicUsers', () => {
  test('só devolve quem tem vínculo (ativo ou não) naquela conta; a conta B nunca enxerga membro de A', async () => {
    const upload = await makeUpload(null)
    const ativo = await makeUser({ name: 'Ativo', avatarUploadId: upload.id })
    await makeMembership(businessId, ativo.id, 'MANAGER')
    const inativo = await makeUser({ name: 'Inativo' })
    const mi = await makeMembership(businessId, inativo.id, 'PROFESSIONAL')
    await prisma.membership.update({ where: { id: mi.id }, data: { active: false } })
    const contaB = (await makeBusiness()).id
    const deB = await makeUser({ name: 'Da B' })
    await makeMembership(contaB, deB.id, 'OWNER')
    const semVinculo = await makeUser({ name: 'Solto' })
    const ids = [ativo.id, inativo.id, deB.id, semVinculo.id, randomUUID(), 'nao-e-uuid', ativo.id]

    const emA = await publicUsers(businessId, ids)
    expect([...emA.keys()].sort()).toEqual([ativo.id, inativo.id].sort())
    expect(emA.get(ativo.id)).toEqual({ name: 'Ativo', email: ativo.email, avatarUrl: `/arquivos/${upload.path}` })
    expect(emA.get(inativo.id)).toEqual({ name: 'Inativo', email: inativo.email, avatarUrl: null })

    const emB = await publicUsers(contaB, ids)
    expect([...emB.keys()]).toEqual([deB.id])
    expect(JSON.stringify([...emB.values()])).not.toContain(ativo.email)
  })

  test('lista vazia ou conta inválida devolve mapa vazio sem consultar', async () => {
    expect((await publicUsers(businessId, [])).size).toBe(0)
    expect((await publicUsers('nao-e-uuid', [userId])).size).toBe(0)
  })

  test('nunca expõe hash de senha nem campos além de nome, e-mail e foto', async () => {
    const m = await publicUsers(businessId, [userId])
    expect(Object.keys(m.get(userId) ?? {}).sort()).toEqual(['avatarUrl', 'email', 'name'])
  })
})
