import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Actor, TenantContext } from '@/server/auth/actor'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { OUTRA_LOJA_MESSAGE } from '@/server/domain/platform/access-core'
import {
  addTeamMember,
  changeAccessRole,
  inviteAccess,
  listAccess,
  resendAccessInvite,
  sendAccessPasswordReset,
  setAccessActive,
} from '@/server/domain/team/access'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeMembership, makePlatformAdmin, makeProfessional, makeService, makeUser, memberOf } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const AGORA = new Date('2026-11-17T12:00:00.000Z')
const mail = fakeMail()
let businessId: string
let dono: TenantContext
let gerente: TenantContext
let profissional: TenantContext
let suporte: TenantContext
let adminId: string

beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ name: 'Barbearia Central' })).id
  const conta = { id: businessId }
  dono = await ctxWithRole(conta, 'OWNER', { now: AGORA })
  gerente = await ctxWithRole(conta, 'MANAGER', { now: AGORA })
  profissional = await ctxWithRole(conta, 'PROFESSIONAL', { now: AGORA })
  const admin = await makePlatformAdmin({ name: 'Ana Admin' })
  adminId = admin.id
  suporte = await makeCtx(conta, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name }, now: AGORA })
  mail.install()
})
afterEach(() => mail.uninstall())

const mailTo = (to: string) => mail.sent.filter((m) => m.to === to)
const linkToken = (path: string, text: string): string => {
  const m = new RegExp(`${path}/([A-Za-z0-9_-]+)`).exec(text)
  if (!m?.[1]) throw new Error(`O e-mail não traz o link ${path}.`)
  return m[1]
}

async function vinculo(role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', businessIdAlvo = businessId) {
  const user = await makeUser()
  const membership = await makeMembership(businessIdAlvo, user.id, role)
  return { user, membership }
}

async function novaSessao(userId: string, activeBusinessId: string | null, token = randomUUID()) {
  return prisma.session.create({
    data: { userId, activeBusinessId, tokenHash: hashToken(token), expiresAt: addMinutes(AGORA, 600) },
  })
}

async function novoRefresh(membershipId: string, businessIdAlvo = businessId) {
  return prisma.refreshToken.create({
    data: {
      businessId: businessIdAlvo,
      subject: 'MEMBER',
      membershipId,
      familyId: randomUUID(),
      tokenHash: hashToken(randomUUID()),
      expiresAt: addMinutes(AGORA, 600),
    },
  })
}

describe('inviteAccess', () => {
  test('dono convida gerente: usuário sem senha, vínculo, convite só com hash, e-mail com o link e auditoria do dono', async () => {
    const m = await inviteAccess(dono, { name: 'Bia Souza', email: 'Bia@Exemplo.test', role: 'MANAGER' })
    expect(m).toMatchObject({ name: 'Bia Souza', email: 'bia@exemplo.test', role: 'MANAGER', active: true, hasPassword: false, professionalId: null })
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'bia@exemplo.test' } })
    expect(user.searchName).toBe('bia souza')
    expect(await prisma.membership.findFirstOrThrow({ where: { businessId, userId: user.id } })).toMatchObject({ id: m.membershipId, role: 'MANAGER' })
    expect(mailTo('bia@exemplo.test')).toHaveLength(1)
    const token = linkToken('/definir-senha', mail.sent[0]?.text ?? '')
    expect(await prisma.userToken.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ purpose: 'INVITE', tokenHash: hashToken(token) })
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'team.member_invited' } })
    expect(log).toMatchObject({ actorType: 'USER', actorId: memberOf(dono).userId, onBehalf: false, targetId: m.membershipId })
    expect(JSON.stringify(log.metadata)).not.toContain(token)
  })

  test('com professionalId liga o acesso à ficha; a ficha de outra conta, arquivada ou inexistente é recusada sem criar nada', async () => {
    const ficha = await makeProfessional(businessId, { name: 'Caio' })
    const m = await inviteAccess(dono, { name: 'Caio Lima', email: 'caio@exemplo.test', role: 'PROFESSIONAL', professionalId: ficha.id })
    expect(m.professionalId).toBe(ficha.id)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: ficha.id } })).membershipId).toBe(m.membershipId)
    expect((await listAccess(dono)).find((x) => x.membershipId === m.membershipId)?.professionalId).toBe(ficha.id)

    const outra = await makeBusiness()
    const deOutra = await makeProfessional(outra.id)
    const arquivada = await makeProfessional(businessId, { archivedAt: AGORA })
    for (const professionalId of [deOutra.id, arquivada.id, randomUUID(), 'nao-e-uuid']) {
      const e = await domainError(inviteAccess(dono, { name: 'Dani', email: 'dani@exemplo.test', role: 'PROFESSIONAL', professionalId }))
      expect(['not_found', 'validation']).toContain(e.code)
    }
    expect(await prisma.user.count({ where: { email: 'dani@exemplo.test' } })).toBe(0)
    expect((await prisma.professional.findUniqueOrThrow({ where: { id: deOutra.id } })).membershipId).toBeNull()
  })

  test('ficha de profissional com dois acessos: o segundo convite é conflict e nada é criado', async () => {
    const ficha = await makeProfessional(businessId)
    await inviteAccess(dono, { name: 'Caio Lima', email: 'caio@exemplo.test', role: 'PROFESSIONAL', professionalId: ficha.id })
    const e = await domainError(inviteAccess(dono, { name: 'Edu', email: 'edu@exemplo.test', role: 'PROFESSIONAL', professionalId: ficha.id }))
    expect(e.code).toBe('conflict')
    expect(await prisma.user.count({ where: { email: 'edu@exemplo.test' } })).toBe(0)
    expect(mailTo('edu@exemplo.test')).toHaveLength(0)
  })

  test('dois convites simultâneos para a mesma ficha: um vincula, o outro recebe conflict', async () => {
    const ficha = await makeProfessional(businessId)
    const pedir = (email: string) => inviteAccess(dono, { name: 'Fulano', email, role: 'PROFESSIONAL', professionalId: ficha.id })
    const r = await Promise.allSettled([pedir('um@exemplo.test'), pedir('dois@exemplo.test')])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.membership.count({ where: { businessId, role: 'PROFESSIONAL', id: { not: memberOf(profissional).membershipId } } })).toBe(1)
  })

  test('usuário que já existe e tem senha só ganha o vínculo e recebe o aviso de acesso, sem convite', async () => {
    const user = await makeUser({ email: 'carla@exemplo.test', name: 'Carla Dias', password: 'senha-da-carla-1' })
    const m = await inviteAccess(dono, { name: 'Outro Nome', email: 'CARLA@exemplo.test', role: 'PROFESSIONAL' })
    expect(m).toMatchObject({ userId: user.id, name: 'Carla Dias', hasPassword: true })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash)
    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(0)
    expect(mail.sent[0]?.text).not.toContain('/definir-senha/')
    expect(mail.sent[0]?.text).toContain('/entrar')
    expect(mail.sent[0]?.text).not.toMatch(/\/entrar\//)
  })

  test('mesma pessoa duas vezes na conta é conflict', async () => {
    await inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' })
    expect((await domainError(inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'PROFESSIONAL' }))).code).toBe('conflict')
  })

  test('gerente convida gerente e profissional, mas não cria dono (forbidden, nada é criado)', async () => {
    await inviteAccess(gerente, { name: 'Gil', email: 'gil@exemplo.test', role: 'MANAGER' })
    await inviteAccess(gerente, { name: 'Hana', email: 'hana@exemplo.test', role: 'PROFESSIONAL' })
    const e = await domainError(inviteAccess(gerente, { name: 'Ivo', email: 'ivo@exemplo.test', role: 'OWNER' }))
    expect(e.code).toBe('forbidden')
    expect(await prisma.user.count({ where: { email: 'ivo@exemplo.test' } })).toBe(0)
    expect(mailTo('ivo@exemplo.test')).toHaveLength(0)
  })

  test('dono e suporte podem convidar outro dono', async () => {
    expect((await inviteAccess(dono, { name: 'Jo', email: 'jo@exemplo.test', role: 'OWNER' })).role).toBe('OWNER')
    expect((await inviteAccess(suporte, { name: 'Lu', email: 'lu@exemplo.test', role: 'OWNER' })).role).toBe('OWNER')
  })

  test('validação por campo: e-mail inválido, nome vazio e papel desconhecido', async () => {
    const e = await domainError(inviteAccess(dono, { name: ' ', email: 'x', role: 'CHEFE' as never }))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {}).sort()).toEqual(['email', 'name', 'role'])
  })
})

describe('autorização', () => {
  test('profissional recebe forbidden em toda função de acesso', async () => {
    const alvo = await vinculo('MANAGER')
    const chamadas = [
      () => listAccess(profissional),
      () => inviteAccess(profissional, { name: 'Bia', email: 'bia@exemplo.test', role: 'PROFESSIONAL' }),
      () => changeAccessRole(profissional, alvo.membership.id, 'PROFESSIONAL'),
      () => setAccessActive(profissional, alvo.membership.id, false),
      () => resendAccessInvite(profissional, alvo.membership.id),
      () => sendAccessPasswordReset(profissional, alvo.membership.id),
    ]
    for (const c of chamadas) expect((await domainError(c())).code).toBe('forbidden')
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: alvo.membership.id } })).active).toBe(true)
  })

  test('ator que não é da equipe (cliente, visitante, sistema, admin sem entrar como suporte) recebe forbidden', async () => {
    const atores: Actor[] = [
      { kind: 'customer', customerId: randomUUID(), name: 'Cli' },
      { kind: 'guest' },
      { kind: 'system' },
      { kind: 'platform_admin', adminId, name: 'Ana Admin' },
    ]
    for (const actor of atores) {
      const ctx = { ...dono, actor }
      expect((await domainError(listAccess(ctx))).code).toBe('forbidden')
      expect((await domainError(inviteAccess(ctx, { name: 'Bia', email: 'bia@exemplo.test', role: 'PROFESSIONAL' }))).code).toBe('forbidden')
    }
  })

  test('quem foi desativado ou rebaixado depois de o contexto ser montado não age mais', async () => {
    await prisma.membership.update({ where: { id: memberOf(gerente).membershipId }, data: { active: false } })
    expect((await domainError(inviteAccess(gerente, { name: 'Bia', email: 'bia@exemplo.test', role: 'PROFESSIONAL' }))).code).toBe('forbidden')
    const outro = await ctxWithRole({ id: businessId }, 'OWNER', { now: AGORA })
    const alvo = await vinculo('PROFESSIONAL')
    await prisma.membership.update({ where: { id: memberOf(outro).membershipId }, data: { role: 'PROFESSIONAL' } })
    expect((await domainError(setAccessActive(outro, alvo.membership.id, false))).code).toBe('forbidden')
    expect((await domainError(changeAccessRole(outro, alvo.membership.id, 'MANAGER'))).code).toBe('forbidden')
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: alvo.membership.id } })).active).toBe(true)
  })

  test('gerente não mexe em dono: papel, situação, convite e redefinição, nem promove alguém a dono', async () => {
    const outroDono = await vinculo('OWNER')
    const pendente = await inviteAccess(dono, { name: 'Mia', email: 'mia@exemplo.test', role: 'OWNER' })
    const prof = await vinculo('PROFESSIONAL')
    const chamadas = [
      () => changeAccessRole(gerente, outroDono.membership.id, 'MANAGER'),
      () => setAccessActive(gerente, outroDono.membership.id, false),
      () => resendAccessInvite(gerente, pendente.membershipId),
      () => sendAccessPasswordReset(gerente, outroDono.membership.id),
      () => changeAccessRole(gerente, prof.membership.id, 'OWNER'),
    ]
    for (const c of chamadas) expect((await domainError(c())).code).toBe('forbidden')
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: outroDono.membership.id } })).toMatchObject({ role: 'OWNER', active: true })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: prof.membership.id } })).role).toBe('PROFESSIONAL')
  })

  test('gerente muda papel e situação de gerentes e profissionais', async () => {
    const outroGerente = await vinculo('MANAGER')
    const prof = await vinculo('PROFESSIONAL')
    expect((await changeAccessRole(gerente, prof.membership.id, 'MANAGER')).role).toBe('MANAGER')
    expect((await changeAccessRole(gerente, outroGerente.membership.id, 'PROFESSIONAL')).role).toBe('PROFESSIONAL')
    expect((await setAccessActive(gerente, prof.membership.id, false)).active).toBe(false)
  })

  test('ninguém altera o próprio vínculo (papel ou situação), nem o dono nem o suporte-dono', async () => {
    const donoId = memberOf(dono).membershipId
    const gerenteId = memberOf(gerente).membershipId
    const chamadas = [
      () => changeAccessRole(dono, donoId, 'MANAGER'),
      () => setAccessActive(dono, donoId, false),
      () => changeAccessRole(gerente, gerenteId, 'PROFESSIONAL'),
      () => setAccessActive(gerente, gerenteId, false),
    ]
    for (const c of chamadas) expect((await domainError(c())).code).toBe('forbidden')
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: donoId } })).toMatchObject({ role: 'OWNER', active: true })
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: gerenteId } })).toMatchObject({ role: 'MANAGER', active: true })
  })

  test('conta B nunca vê nem mexe em membro da conta A: not_found e nada muda', async () => {
    const contaB = await makeBusiness({ name: 'Outra Conta' })
    const donoB = await ctxWithRole(contaB, 'OWNER', { now: AGORA })
    const membroA = await vinculo('MANAGER')
    const pendenteA = await inviteAccess(dono, { name: 'Nina', email: 'nina@exemplo.test', role: 'MANAGER' })
    expect((await listAccess(donoB)).map((m) => m.membershipId)).not.toContain(membroA.membership.id)
    const chamadas = [
      () => changeAccessRole(donoB, membroA.membership.id, 'PROFESSIONAL'),
      () => setAccessActive(donoB, membroA.membership.id, false),
      () => resendAccessInvite(donoB, pendenteA.membershipId),
      () => sendAccessPasswordReset(donoB, membroA.membership.id),
      () => setAccessActive(donoB, 'nao-e-uuid', false),
    ]
    for (const c of chamadas) expect((await domainError(c())).code).toBe('not_found')
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: membroA.membership.id } })).toMatchObject({ role: 'MANAGER', active: true })
    expect(mailTo('nina@exemplo.test')).toHaveLength(1)
  })
})

describe('último dono e papéis', () => {
  test('suporte não rebaixa nem desativa o último dono ativo; com dois donos, o dono tira o outro e o último fica protegido', async () => {
    const donoId = memberOf(dono).membershipId
    expect((await domainError(changeAccessRole(suporte, donoId, 'MANAGER'))).code).toBe('conflict')
    expect((await domainError(setAccessActive(suporte, donoId, false))).code).toBe('conflict')
    const segundo = await vinculo('OWNER')
    expect((await setAccessActive(dono, segundo.membership.id, false)).active).toBe(false)
    expect((await domainError(setAccessActive(suporte, donoId, false))).code).toBe('conflict')
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: donoId } })).toMatchObject({ role: 'OWNER', active: true })
  })

  test('dois donos se desativando ao mesmo tempo: só um passa e a conta fica com um dono ativo', async () => {
    const segundo = await ctxWithRole({ id: businessId }, 'OWNER', { now: AGORA })
    const r = await Promise.allSettled([
      setAccessActive(dono, memberOf(segundo).membershipId, false),
      setAccessActive(segundo, memberOf(dono).membershipId, false),
    ])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.membership.count({ where: { businessId, role: 'OWNER', active: true } })).toBe(1)
  })

  test('dono rebaixa outro dono quando sobra ele mesmo', async () => {
    const segundo = await vinculo('OWNER')
    expect((await changeAccessRole(dono, segundo.membership.id, 'MANAGER')).role).toBe('MANAGER')
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'team.role_changed' } })
    expect(log).toMatchObject({ actorType: 'USER', actorId: memberOf(dono).userId })
    expect(log.metadata).toMatchObject({ from: 'OWNER', to: 'MANAGER' })
  })
})

describe('revogação', () => {
  test('desativar derruba as sessões do painel e os tokens do app daquele vínculo; outras contas e pessoas ficam; reativar não devolve', async () => {
    const outra = (await makeBusiness()).id
    const alvo = await vinculo('PROFESSIONAL')
    const sessaoAqui = await novaSessao(alvo.user.id, businessId)
    const sessaoOutra = await novaSessao(alvo.user.id, outra)
    const tokenAqui = await novoRefresh(alvo.membership.id)
    const colega = await vinculo('PROFESSIONAL')
    const sessaoColega = await novaSessao(colega.user.id, businessId)
    const tokenColega = await novoRefresh(colega.membership.id)

    await setAccessActive(dono, alvo.membership.id, false)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoAqui.id } })).revokedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoOutra.id } })).revokedAt).toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: tokenAqui.id } })).revokedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoColega.id } })).revokedAt).toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: tokenColega.id } })).revokedAt).toBeNull()

    await setAccessActive(dono, alvo.membership.id, true)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoAqui.id } })).revokedAt).not.toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: tokenAqui.id } })).revokedAt).not.toBeNull()
  })

  test('rebaixar derruba sessões e tokens; promover não', async () => {
    const alvo = await vinculo('MANAGER')
    const sessao = await novaSessao(alvo.user.id, businessId)
    const token = await novoRefresh(alvo.membership.id)
    await changeAccessRole(dono, alvo.membership.id, 'OWNER')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt).toBeNull()
    await changeAccessRole(dono, alvo.membership.id, 'PROFESSIONAL')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).not.toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt).not.toBeNull()
  })

  test('desativar quem ainda não definiu a senha apaga o convite pendente e o link de redefinição', async () => {
    const m = await inviteAccess(dono, { name: 'Bia Souza', email: 'bia@exemplo.test', role: 'MANAGER' })
    await prisma.userToken.create({
      data: { userId: m.userId, purpose: 'PASSWORD_RESET', tokenHash: hashToken('qualquer'), expiresAt: addMinutes(AGORA, 60) },
    })
    await setAccessActive(dono, m.membershipId, false)
    expect(await prisma.userToken.count({ where: { userId: m.userId } })).toBe(0)
  })
})

describe('suporte', () => {
  test('convida e desativa com a marca de suporte na auditoria, mas não dispara redefinição de senha', async () => {
    const m = await inviteAccess(suporte, { name: 'Bia Souza', email: 'bia@exemplo.test', role: 'MANAGER' })
    await setAccessActive(suporte, m.membershipId, false)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'team.member_deactivated' } })
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: adminId, actorName: 'Ana Admin', onBehalf: true })

    const alvo = await vinculo('MANAGER')
    expect((await domainError(sendAccessPasswordReset(suporte, alvo.membership.id))).code).toBe('forbidden')
    expect(await prisma.userToken.count({ where: { userId: alvo.user.id } })).toBe(0)
    expect(mailTo(alvo.user.email)).toHaveLength(0)
  })

  test('admin desativado depois de entrar como suporte não age mais', async () => {
    await prisma.platformAdmin.update({ where: { id: adminId }, data: { active: false } })
    expect((await domainError(inviteAccess(suporte, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }))).code).toBe('forbidden')
    expect(await prisma.user.count({ where: { email: 'bia@exemplo.test' } })).toBe(0)
  })
})

describe('resendAccessInvite', () => {
  test('troca o convite anterior, manda e-mail novo e audita', async () => {
    const m = await inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' })
    const velho = linkToken('/definir-senha', mail.sent[0]?.text ?? '')
    await resendAccessInvite(dono, m.membershipId)
    const novo = linkToken('/definir-senha', mail.sent[1]?.text ?? '')
    expect(novo).not.toBe(velho)
    expect((await prisma.userToken.findMany({ where: { userId: m.userId } })).map((t) => t.tokenHash)).toEqual([hashToken(novo)])
    expect(await prisma.auditLog.count({ where: { businessId, action: 'team.invite_resent' } })).toBe(1)
  })

  test('quem já tem senha ou está desativado não recebe convite: conflict', async () => {
    const comSenha = await vinculo('MANAGER')
    expect((await domainError(resendAccessInvite(dono, comSenha.membership.id))).code).toBe('conflict')
    const m = await inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' })
    await prisma.membership.update({ where: { id: m.membershipId }, data: { active: false } })
    expect((await domainError(resendAccessInvite(dono, m.membershipId))).code).toBe('conflict')
  })
})

describe('sendAccessPasswordReset', () => {
  test('manda o link de redefinição de 60 minutos, só com o hash no banco; o link anterior deixa de valer; audita sem o token', async () => {
    const alvo = await vinculo('PROFESSIONAL')
    await sendAccessPasswordReset(dono, alvo.membership.id)
    const primeiro = linkToken('/redefinir-senha', mail.sent[0]?.text ?? '')
    expect(mail.sent[0]).toMatchObject({ to: alvo.user.email })
    expect(await prisma.userToken.findFirstOrThrow({ where: { userId: alvo.user.id } })).toMatchObject({
      purpose: 'PASSWORD_RESET',
      tokenHash: hashToken(primeiro),
      usedAt: null,
      expiresAt: addMinutes(AGORA, 60),
    })
    await sendAccessPasswordReset(gerente, alvo.membership.id)
    const segundo = linkToken('/redefinir-senha', mail.sent[1]?.text ?? '')
    expect(segundo).not.toBe(primeiro)
    expect((await prisma.userToken.findMany({ where: { userId: alvo.user.id } })).map((t) => t.tokenHash)).toEqual([hashToken(segundo)])
    const logs = await prisma.auditLog.findMany({ where: { businessId, action: 'team.password_reset_sent' } })
    expect(logs).toHaveLength(2)
    expect(JSON.stringify(logs)).not.toContain(primeiro)
    expect(JSON.stringify(logs)).not.toContain(segundo)
  })

  test('quem ainda não tem senha (convite pendente) ou está desativado recebe conflict e nada é enviado', async () => {
    const pendente = await inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' })
    const enviados = mail.sent.length
    expect((await domainError(sendAccessPasswordReset(dono, pendente.membershipId))).code).toBe('conflict')
    const inativo = await vinculo('PROFESSIONAL')
    await prisma.membership.update({ where: { id: inativo.membership.id }, data: { active: false } })
    expect((await domainError(sendAccessPasswordReset(dono, inativo.membership.id))).code).toBe('conflict')
    expect(mail.sent).toHaveLength(enviados)
  })
})

describe('listAccess', () => {
  test('lista todos os vínculos da conta, ativos ou não, com ficha, senha e último acesso', async () => {
    const ficha = await makeProfessional(businessId)
    const user = await makeUser({ lastLoginAt: new Date('2026-01-01T00:00:00.000Z') })
    const m = await makeMembership(businessId, user.id, 'PROFESSIONAL')
    await prisma.session.create({
      data: { userId: user.id, activeBusinessId: businessId, tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600), createdAt: AGORA },
    })
    await prisma.professional.update({ where: { id: ficha.id }, data: { membershipId: m.id } })
    await prisma.membership.update({ where: { id: m.id }, data: { active: false } })
    const lista = await listAccess(gerente)
    expect(lista).toHaveLength(4)
    expect(lista.find((x) => x.membershipId === m.id)).toMatchObject({ active: false, hasPassword: true, professionalId: ficha.id, lastLoginAt: AGORA })
  })
})

describe('sendAccessPasswordReset: limite e conta arquivada', () => {
  test('reusa o limite por e-mail do pedido de redefinição: o 4º envio em 15 minutos é recusado e não manda e-mail', async () => {
    const alvo = await vinculo('PROFESSIONAL')
    for (let i = 0; i < 3; i++) await sendAccessPasswordReset(dono, alvo.membership.id)
    expect(mailTo(alvo.user.email)).toHaveLength(3)
    const e = await domainError(sendAccessPasswordReset(gerente, alvo.membership.id))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('too_early')
    expect(mailTo(alvo.user.email)).toHaveLength(3)
    expect(await prisma.userToken.count({ where: { userId: alvo.user.id } })).toBe(1)
  })

  test('conta arquivada depois do contexto montado: recusa e não envia nada', async () => {
    const alvo = await vinculo('PROFESSIONAL')
    await prisma.business.update({ where: { id: businessId }, data: { status: 'ARCHIVED' } })
    const e = await domainError(sendAccessPasswordReset(dono, alvo.membership.id))
    expect(['forbidden', 'business_unavailable']).toContain(e.code)
    expect(mail.sent).toHaveLength(0)
    expect(await prisma.userToken.count({ where: { userId: alvo.user.id } })).toBe(0)
  })
})

describe('o que o dono vê do usuário: só o que é da própria conta', () => {
  // Quem sai de uma loja fica com o vínculo desativado (histórico): só um vínculo ativo por login.
  const vinculoAntigo = (b: string, userId: string) => prisma.membership.create({ data: { businessId: b, userId, role: 'MANAGER', active: false } })
  const sessaoEm = (userId: string, b: string, quando: Date) =>
    prisma.session.create({ data: { userId, activeBusinessId: b, tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600), createdAt: quando } })

  test('lastLoginAt global não aparece: só a última sessão registrada NESTA conta, senão null', async () => {
    const outra = (await makeBusiness()).id
    const pessoa = await makeUser({ lastLoginAt: new Date('2026-11-16T10:00:00.000Z') })
    const m = await makeMembership(businessId, pessoa.id, 'PROFESSIONAL')
    await vinculoAntigo(outra, pessoa.id)
    await sessaoEm(pessoa.id, outra, new Date('2026-11-16T10:00:00.000Z'))
    expect((await listAccess(dono)).find((x) => x.membershipId === m.id)?.lastLoginAt).toBeNull()
    await sessaoEm(pessoa.id, businessId, new Date('2026-11-10T08:00:00.000Z'))
    await sessaoEm(pessoa.id, businessId, new Date('2026-11-12T09:30:00.000Z'))
    expect((await listAccess(gerente)).find((x) => x.membershipId === m.id)?.lastLoginAt).toEqual(new Date('2026-11-12T09:30:00.000Z'))
  })

  test('convidar quem já existe em outra conta não devolve o último acesso nem a senha de lá', async () => {
    const outra = (await makeBusiness()).id
    const existente = await makeUser({ email: 'carla@exemplo.test', password: 'senha-da-carla-1', lastLoginAt: AGORA })
    await vinculoAntigo(outra, existente.id)
    const m = await inviteAccess(dono, { name: 'Carla', email: 'carla@exemplo.test', role: 'PROFESSIONAL' })
    expect(m.lastLoginAt).toBeNull()
    expect((await listAccess(dono)).find((x) => x.userId === existente.id)?.lastLoginAt).toBeNull()
  })

  test('hasPassword é "convite pendente" desta conta: falso só para convite emitido por ela a quem ainda não tem senha', async () => {
    const pendente = await inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' })
    expect(pendente.hasPassword).toBe(false)
    expect((await listAccess(dono)).find((x) => x.membershipId === pendente.membershipId)?.hasPassword).toBe(false)
    expect((await resendAccessInvite(dono, pendente.membershipId), (await listAccess(dono)).find((x) => x.membershipId === pendente.membershipId)?.hasPassword)).toBe(false)
    const comSenha = await vinculo('PROFESSIONAL')
    expect((await listAccess(dono)).find((x) => x.membershipId === comSenha.membership.id)?.hasPassword).toBe(true)
    await prisma.user.update({ where: { id: pendente.userId }, data: { passwordHash: comSenha.user.passwordHash } })
    expect((await listAccess(dono)).find((x) => x.membershipId === pendente.membershipId)?.hasPassword).toBe(true)
  })

  test('o suporte também vê só o que é da conta', async () => {
    const outra = (await makeBusiness()).id
    const pessoa = await makeUser({ lastLoginAt: AGORA })
    await makeMembership(businessId, pessoa.id, 'PROFESSIONAL')
    await vinculoAntigo(outra, pessoa.id)
    expect((await listAccess(suporte)).find((x) => x.userId === pessoa.id)?.lastLoginAt).toBeNull()
  })

  test('as ações devolvem o membro no mesmo recorte da conta', async () => {
    const outra = (await makeBusiness()).id
    const pessoa = await makeUser({ lastLoginAt: AGORA })
    const m = await makeMembership(businessId, pessoa.id, 'PROFESSIONAL')
    await vinculoAntigo(outra, pessoa.id)
    expect((await changeAccessRole(dono, m.id, 'MANAGER')).lastLoginAt).toBeNull()
    expect((await setAccessActive(dono, m.id, false)).lastLoginAt).toBeNull()
  })
})

describe('uma loja por login da equipe', () => {
  async function outraLoja(): Promise<string> {
    return (await makeBusiness({ name: 'Outra Loja' })).id
  }

  test('convidar quem é ativo em outra loja: conflict member_of_other_business, nada gravado', async () => {
    const user = await makeUser({ email: 'ana@exemplo.test' })
    await makeMembership(await outraLoja(), user.id, 'MANAGER')
    const e = await domainError(inviteAccess(dono, { name: 'Ana', email: 'ana@exemplo.test', role: 'PROFESSIONAL' }))
    expect(e).toMatchObject({ code: 'conflict', reason: 'member_of_other_business', message: OUTRA_LOJA_MESSAGE })
    expect(e.fields).toEqual({ email: OUTRA_LOJA_MESSAGE })
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'team.member_invited' } })).toBe(0)
    expect(mailTo('ana@exemplo.test')).toHaveLength(0)
  })

  test('quem foi desativado na loja A pode ser convidado na B; reativar na A depois é recusado', async () => {
    const lojaA = await outraLoja()
    const user = await makeUser({ email: 'bia@exemplo.test' })
    const antigo = await makeMembership(lojaA, user.id, 'PROFESSIONAL')
    await prisma.membership.update({ where: { id: antigo.id }, data: { active: false } })
    await inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'PROFESSIONAL' })
    expect(await prisma.membership.count({ where: { userId: user.id, active: true } })).toBe(1)
    const donoA = await ctxWithRole({ id: lojaA }, 'OWNER', { now: AGORA })
    const e = await domainError(setAccessActive(donoA, antigo.id, true))
    expect(e).toMatchObject({ code: 'conflict', reason: 'member_of_other_business', message: OUTRA_LOJA_MESSAGE })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: antigo.id } })).active).toBe(false)
  })

  test('dois convites simultâneos do mesmo e-mail em lojas diferentes: um passa, o outro é conflict com a mesma frase', async () => {
    const lojaB = await outraLoja()
    const donoB = await ctxWithRole({ id: lojaB }, 'OWNER', { now: AGORA })
    const entrada = { name: 'Caio', email: 'caio@exemplo.test', role: 'PROFESSIONAL' as const }
    const r = await Promise.allSettled([inviteAccess(dono, entrada), inviteAccess(donoB, entrada)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const recusado = r.find((x) => x.status === 'rejected')
    expect(recusado?.status === 'rejected' ? recusado.reason : null).toMatchObject({
      code: 'conflict',
      reason: 'member_of_other_business',
      message: OUTRA_LOJA_MESSAGE,
    })
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'caio@exemplo.test' } })
    expect(await prisma.membership.count({ where: { userId: user.id, active: true } })).toBe(1)
  })

  test('o banco recusa um segundo vínculo ativo do mesmo usuário', async () => {
    const user = await makeUser()
    await makeMembership(businessId, user.id, 'MANAGER')
    await expect(makeMembership(await outraLoja(), user.id, 'MANAGER')).rejects.toMatchObject({ code: 'P2002' })
  })
})

describe('addTeamMember: cadastro num passo e situação do convite', () => {
  const membroDe = async (email: string) => prisma.membership.findFirstOrThrow({ where: { businessId, user: { email } }, include: { professionals: true } })

  test('cria ficha, vínculo e convite numa transação e manda o e-mail', async () => {
    const servico = await makeService(businessId, { name: 'Banho' })
    const antes = await makeProfessional(businessId, { name: 'Antiga' })
    const m = await addTeamMember(dono, { name: 'Duda Lima', email: 'Duda@Exemplo.test', role: 'PROFESSIONAL' })
    expect(m).toMatchObject({ name: 'Duda Lima', email: 'duda@exemplo.test', role: 'PROFESSIONAL', active: true, hasPassword: false, inviteMailFailed: false })
    expect(m.professionalId).not.toBeNull()
    const vinculo = await membroDe('duda@exemplo.test')
    expect(vinculo.professionals).toHaveLength(1)
    const ficha = await prisma.professional.findUniqueOrThrow({ where: { id: m.professionalId ?? '' }, include: { services: true } })
    expect(ficha).toMatchObject({ name: 'Duda Lima', membershipId: vinculo.id, commissionBps: 0, active: true })
    expect(ficha.displayOrder).toBeGreaterThan(antes.displayOrder)
    expect(ficha.services.map((s) => s.serviceId)).toEqual([servico.id])
    expect(mailTo('duda@exemplo.test')).toHaveLength(1)
    expect(mailTo('duda@exemplo.test')[0]?.text).toContain('/definir-senha/')
    expect((await membroDe('duda@exemplo.test')).inviteMailFailedAt).toBeNull()
  })

  test('gerente também ganha a ficha e o convite', async () => {
    const m = await addTeamMember(dono, { name: 'Gil Gerente', email: 'gil@exemplo.test', role: 'MANAGER' })
    expect(m).toMatchObject({ role: 'MANAGER', inviteMailFailed: false })
    expect(m.professionalId).not.toBeNull()
  })

  test('com o envio falhando o cadastro fica e inviteMailFailed é true, na lista também', async () => {
    mail.failing = true
    const m = await addTeamMember(dono, { name: 'Eva Dias', email: 'eva@exemplo.test', role: 'PROFESSIONAL' })
    expect(m.inviteMailFailed).toBe(true)
    expect(m.professionalId).not.toBeNull()
    expect((await membroDe('eva@exemplo.test')).inviteMailFailedAt).not.toBeNull()
    expect((await listAccess(dono)).find((x) => x.membershipId === m.membershipId)?.inviteMailFailed).toBe(true)
  })

  test('sem canal de e-mail configurado conta como convite não enviado', async () => {
    mail.uninstall()
    const m = await addTeamMember(dono, { name: 'Fia Reis', email: 'fia@exemplo.test', role: 'PROFESSIONAL' })
    expect(m.inviteMailFailed).toBe(true)
  })

  test('reenviar com sucesso limpa a falha; reenviar falhando mantém', async () => {
    mail.failing = true
    const m = await addTeamMember(dono, { name: 'Eva Dias', email: 'eva@exemplo.test', role: 'PROFESSIONAL' })
    expect(await resendAccessInvite(dono, m.membershipId)).toEqual({ inviteMailFailed: true })
    expect((await membroDe('eva@exemplo.test')).inviteMailFailedAt).not.toBeNull()
    mail.failing = false
    expect(await resendAccessInvite(dono, m.membershipId)).toEqual({ inviteMailFailed: false })
    expect((await membroDe('eva@exemplo.test')).inviteMailFailedAt).toBeNull()
    expect((await listAccess(dono)).find((x) => x.membershipId === m.membershipId)?.inviteMailFailed).toBe(false)
  })

  test('e-mail de outra loja: conflict, nem ficha nem vínculo nem usuário novo', async () => {
    const outra = await makeBusiness()
    const alheio = await makeUser({ email: 'alheio@exemplo.test' })
    await makeMembership(outra.id, alheio.id, 'MANAGER')
    const fichas = await prisma.professional.count({ where: { businessId } })
    const e = await domainError(addTeamMember(dono, { name: 'Alheio', email: 'alheio@exemplo.test', role: 'PROFESSIONAL' }))
    expect(e).toMatchObject({ code: 'conflict', reason: 'member_of_other_business', message: OUTRA_LOJA_MESSAGE })
    expect(await prisma.professional.count({ where: { businessId } })).toBe(fichas)
    expect(await prisma.membership.count({ where: { businessId, userId: alheio.id } })).toBe(0)
    expect(mail.sent).toHaveLength(0)
  })

  test('a mesma pessoa duas vezes: conflict e a segunda ficha não fica', async () => {
    await addTeamMember(dono, { name: 'Duda', email: 'duda@exemplo.test', role: 'PROFESSIONAL' })
    const fichas = await prisma.professional.count({ where: { businessId } })
    expect((await domainError(addTeamMember(dono, { name: 'Duda', email: 'duda@exemplo.test', role: 'PROFESSIONAL' }))).code).toBe('conflict')
    expect(await prisma.professional.count({ where: { businessId } })).toBe(fichas)
  })

  test('profissional não cadastra ninguém: forbidden', async () => {
    expect((await domainError(addTeamMember(profissional, { name: 'X', email: 'x@exemplo.test', role: 'PROFESSIONAL' }))).code).toBe('forbidden')
    expect(await prisma.user.count({ where: { email: 'x@exemplo.test' } })).toBe(0)
  })

  test('papel OWNER (ou desconhecido) em addTeamMember: validation no campo role', async () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const e = await domainError(addTeamMember(dono, { name: 'X', email: 'x@exemplo.test', role: role as 'MANAGER' }))
      expect(e.code).toBe('validation')
      expect(Object.keys(e.fields ?? {})).toEqual(['role'])
    }
    expect(await prisma.user.count({ where: { email: 'x@exemplo.test' } })).toBe(0)
  })

  test('e-mail vazio ou inválido: validation no campo email', async () => {
    const e = await domainError(addTeamMember(dono, { name: 'X', email: '', role: 'PROFESSIONAL' }))
    expect(Object.keys(e.fields ?? {})).toContain('email')
  })
})
