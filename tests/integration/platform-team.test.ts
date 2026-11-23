import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { OUTRA_LOJA_MESSAGE } from '@/server/domain/platform/access-core'
import {
  changeMemberRole,
  inviteMember,
  listTeam,
  resendInvite,
  setMemberActive,
} from '@/server/domain/platform/team'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeMembership, makePlatformAdmin, makeProfessional, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const AGORA = new Date('2026-11-16T12:00:00.000Z')
const mail = fakeMail()
let actor: PlatformAdminActor
let adminId: string
let businessId: string

beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin({ name: 'Ana Admin' })
  adminId = admin.id
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
  businessId = (await makeBusiness({ name: 'Barbearia Central' })).id
  mail.install()
})
afterEach(() => mail.uninstall())

function tokenDoEmail(i = mail.sent.length - 1): string {
  const m = /\/definir-senha\/([A-Za-z0-9_-]+)/.exec(mail.sent[i]?.text ?? '')
  if (!m?.[1]) throw new Error('O e-mail não traz o link de definir senha.')
  return m[1]
}

async function novoVinculo(role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', businessIdAlvo = businessId) {
  const user = await makeUser()
  const membership = await makeMembership(businessIdAlvo, user.id, role)
  return { user, membership }
}

async function novaSessao(userId: string, activeBusinessId: string | null) {
  return prisma.session.create({
    data: { userId, activeBusinessId, tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600) },
  })
}

async function novoRefresh(membershipId: string) {
  return prisma.refreshToken.create({
    data: {
      businessId,
      subject: 'MEMBER',
      membershipId,
      familyId: randomUUID(),
      tokenHash: hashToken(randomUUID()),
      expiresAt: addMinutes(AGORA, 600),
    },
  })
}

describe('inviteMember', () => {
  test('pessoa nova: usuário sem senha, vínculo, convite só com hash e e-mail com o link', async () => {
    const m = await inviteMember(actor, businessId, { name: 'Bia Souza', email: 'Bia@Exemplo.test', role: 'MANAGER' }, AGORA)
    expect(m).toMatchObject({ name: 'Bia Souza', email: 'bia@exemplo.test', role: 'MANAGER', active: true, hasPassword: false, professionalId: null })
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'bia@exemplo.test' } })
    expect(user.passwordHash).toBeNull()
    expect(user.searchName).toBe('bia souza')
    const vinculo = await prisma.membership.findFirstOrThrow({ where: { businessId, userId: user.id } })
    expect(vinculo).toMatchObject({ id: m.membershipId, role: 'MANAGER', active: true })
    const token = tokenDoEmail()
    const convite = await prisma.userToken.findFirstOrThrow({ where: { userId: user.id } })
    expect(convite).toMatchObject({ purpose: 'INVITE', tokenHash: hashToken(token), usedAt: null })
    expect(convite.expiresAt).toEqual(addMinutes(AGORA, 7 * 24 * 60))
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]).toMatchObject({ to: 'bia@exemplo.test' })
    expect(mail.sent[0]?.text).toContain('Barbearia Central')
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'team.member_invited' } })
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: adminId, actorName: 'Ana Admin', onBehalf: false, targetId: vinculo.id })
    expect(JSON.stringify(log.metadata)).not.toContain(token)
  })

  test('usuário que já existe e tem senha: só o vínculo, senha intacta, sem convite, e-mail de aviso de acesso', async () => {
    const user = await makeUser({ email: 'carla@exemplo.test', name: 'Carla Dias', password: 'senha-da-carla-1' })
    const antes = user.passwordHash
    const m = await inviteMember(actor, businessId, { name: 'Outro Nome', email: 'CARLA@exemplo.test', role: 'PROFESSIONAL' }, AGORA)
    expect(m).toMatchObject({ userId: user.id, name: 'Carla Dias', hasPassword: true, role: 'PROFESSIONAL' })
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(depois.passwordHash).toBe(antes)
    expect(depois.name).toBe('Carla Dias')
    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(0)
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]?.text).not.toContain('/definir-senha/')
    expect(mail.sent[0]?.text).toContain('/entrar/')
  })

  test('mesma pessoa duas vezes na conta (mesmo desativada) dá conflict', async () => {
    await inviteMember(actor, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA)
    const e = await domainError(inviteMember(actor, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'PROFESSIONAL' }, AGORA))
    expect(e.code).toBe('conflict')
    await prisma.membership.updateMany({ where: { businessId }, data: { active: false } })
    expect((await domainError(inviteMember(actor, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'PROFESSIONAL' }, AGORA))).code).toBe('conflict')
    expect(await prisma.membership.count({ where: { businessId } })).toBe(1)
  })

  test('dois convites simultâneos do mesmo e-mail: um vincula, o outro recebe conflict', async () => {
    const pedir = () => inviteMember(actor, businessId, { name: 'Davi', email: 'davi@exemplo.test', role: 'MANAGER' }, AGORA)
    const r = await Promise.allSettled([pedir(), pedir()])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.membership.count({ where: { businessId } })).toBe(1)
    expect(await prisma.user.count({ where: { email: 'davi@exemplo.test' } })).toBe(1)
  })

  test('e-mail inválido e nome vazio viram erro de validação por campo', async () => {
    const e = await domainError(inviteMember(actor, businessId, { name: ' ', email: 'x', role: 'MANAGER' }, AGORA))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {}).sort()).toEqual(['email', 'name'])
  })

  test('conta que não existe: not_found', async () => {
    const e = await domainError(inviteMember(actor, randomUUID(), { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA))
    expect(e.code).toBe('not_found')
  })
})

describe('conta arquivada ou suspensa', () => {
  test('conta arquivada recusa convite e reenvio com business_unavailable e nada é criado nem enviado', async () => {
    const m = await inviteMember(actor, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA)
    mail.sent.length = 0
    await prisma.business.update({ where: { id: businessId }, data: { status: 'ARCHIVED' } })
    const e = await domainError(inviteMember(actor, businessId, { name: 'Caio', email: 'caio@exemplo.test', role: 'MANAGER' }, AGORA))
    expect(e.code).toBe('business_unavailable')
    expect(e.message).toBe('Esta conta está arquivada. Reative a conta antes de convidar alguém.')
    expect((await domainError(resendInvite(actor, m.membershipId, AGORA))).code).toBe('business_unavailable')
    expect(await prisma.user.count({ where: { email: 'caio@exemplo.test' } })).toBe(0)
    expect(mail.sent).toHaveLength(0)
  })

  test('conta suspensa continua aceitando convite e reenvio', async () => {
    await prisma.business.update({ where: { id: businessId }, data: { status: 'SUSPENDED' } })
    const m = await inviteMember(actor, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA)
    await resendInvite(actor, m.membershipId, AGORA)
    expect(mail.sent).toHaveLength(2)
  })
})

describe('listTeam', () => {
  test('lista a equipe da conta com ficha de profissional, senha e último acesso', async () => {
    const dono = await makeUser({ name: 'Dora Dona', password: 'senha-bem-longa' })
    await makeMembership(businessId, dono.id, 'OWNER')
    const pendente = await makeUser({ name: 'Paulo', password: null })
    const vp = await makeMembership(businessId, pendente.id, 'PROFESSIONAL')
    const ficha = await makeProfessional(businessId, { membershipId: vp.id })
    await prisma.user.update({ where: { id: dono.id }, data: { lastLoginAt: AGORA } })
    const outra = await makeBusiness()
    await novoVinculo('OWNER', outra.id)

    const equipe = await listTeam(actor, businessId)
    expect(equipe.map((m) => m.name)).toEqual(['Dora Dona', 'Paulo'])
    expect(equipe[0]).toMatchObject({ role: 'OWNER', hasPassword: true, lastLoginAt: AGORA, professionalId: null, active: true })
    expect(equipe[1]).toMatchObject({ role: 'PROFESSIONAL', hasPassword: false, lastLoginAt: null, professionalId: ficha.id })
  })
})

describe('último dono ativo', () => {
  test('rebaixar o último dono ativo é recusado com a mensagem do que fazer', async () => {
    const { membership } = await novoVinculo('OWNER')
    await novoVinculo('OWNER', (await makeBusiness()).id)
    const e = await domainError(changeMemberRole(actor, membership.id, 'MANAGER'))
    expect(e.code).toBe('conflict')
    expect(e.message).toMatch(/dono/i)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).role).toBe('OWNER')
  })

  test('desativar o último dono ativo é recusado; dono inativo não conta como outro dono', async () => {
    const { membership } = await novoVinculo('OWNER')
    const { membership: inativo } = await novoVinculo('OWNER')
    await prisma.membership.update({ where: { id: inativo.id }, data: { active: false } })
    const e = await domainError(setMemberActive(actor, membership.id, false))
    expect(e.code).toBe('conflict')
    expect(e.message).toMatch(/dono/i)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).active).toBe(true)
  })

  test('com dois donos ativos, um pode ser rebaixado e o outro passa a ser o último', async () => {
    const a = await novoVinculo('OWNER')
    const b = await novoVinculo('OWNER')
    const r = await changeMemberRole(actor, a.membership.id, 'MANAGER')
    expect(r.role).toBe('MANAGER')
    expect((await domainError(setMemberActive(actor, b.membership.id, false))).code).toBe('conflict')
  })

  test('duas desativações simultâneas dos dois últimos donos: só uma passa', async () => {
    const a = await novoVinculo('OWNER')
    const b = await novoVinculo('OWNER')
    const r = await Promise.allSettled([setMemberActive(actor, a.membership.id, false), setMemberActive(actor, b.membership.id, false)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const rejeitada = r.find((x) => x.status === 'rejected')
    expect(rejeitada?.status === 'rejected' && (rejeitada.reason as { code?: string }).code).toBe('conflict')
    expect(await prisma.membership.count({ where: { businessId, role: 'OWNER', active: true } })).toBe(1)
  })

  test('rebaixar e desativar ao mesmo tempo os dois últimos donos: só uma passa', async () => {
    const a = await novoVinculo('OWNER')
    const b = await novoVinculo('OWNER')
    const r = await Promise.allSettled([changeMemberRole(actor, a.membership.id, 'MANAGER'), setMemberActive(actor, b.membership.id, false)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.membership.count({ where: { businessId, role: 'OWNER', active: true } })).toBe(1)
  })
})

describe('desativar e rebaixar', () => {
  test('desativar revoga as sessões do painel da conta ativa e os tokens do app; outras contas ficam', async () => {
    await novoVinculo('OWNER')
    const { user, membership } = await novoVinculo('MANAGER')
    const outra = await makeBusiness()
    const nestaConta = await novaSessao(user.id, businessId)
    const semConta = await novaSessao(user.id, null)
    const emOutra = await novaSessao(user.id, outra.id)
    const doOutro = await novaSessao((await makeUser()).id, businessId)
    const refresh = await novoRefresh(membership.id)

    const r = await setMemberActive(actor, membership.id, false)
    expect(r.active).toBe(false)
    const revogada = async (id: string) => (await prisma.session.findUniqueOrThrow({ where: { id } })).revokedAt !== null
    expect(await revogada(nestaConta.id)).toBe(true)
    expect(await revogada(semConta.id)).toBe(false)
    expect(await revogada(emOutra.id)).toBe(false)
    expect(await revogada(doOutro.id)).toBe(false)
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: refresh.id } })).revokedAt).not.toBeNull()
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'team.member_deactivated' } })
    expect(log).toMatchObject({ actorId: adminId, targetId: membership.id })
  })

  test('reativar não ressuscita sessão nem token', async () => {
    await novoVinculo('OWNER')
    const { user, membership } = await novoVinculo('PROFESSIONAL')
    const sessao = await novaSessao(user.id, businessId)
    const refresh = await novoRefresh(membership.id)
    await setMemberActive(actor, membership.id, false)
    const r = await setMemberActive(actor, membership.id, true)
    expect(r.active).toBe(true)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).not.toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: refresh.id } })).revokedAt).not.toBeNull()
    expect(await prisma.auditLog.count({ where: { businessId, action: 'team.member_activated' } })).toBe(1)
  })

  test('rebaixar o papel derruba sessões e tokens; promover não', async () => {
    await novoVinculo('OWNER')
    const { user, membership } = await novoVinculo('MANAGER')
    const sessao = await novaSessao(user.id, businessId)
    const refresh = await novoRefresh(membership.id)

    const promovido = await changeMemberRole(actor, membership.id, 'OWNER')
    expect(promovido.role).toBe('OWNER')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: refresh.id } })).revokedAt).toBeNull()

    const rebaixado = await changeMemberRole(actor, membership.id, 'PROFESSIONAL')
    expect(rebaixado.role).toBe('PROFESSIONAL')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).not.toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: refresh.id } })).revokedAt).not.toBeNull()
    const log = await prisma.auditLog.findFirstOrThrow({ where: { businessId, action: 'team.role_changed', metadata: { path: ['to'], equals: 'PROFESSIONAL' } } })
    expect(log.metadata).toMatchObject({ from: 'OWNER', to: 'PROFESSIONAL' })
  })

  test('vínculo que não existe: not_found', async () => {
    expect((await domainError(setMemberActive(actor, randomUUID(), false))).code).toBe('not_found')
    expect((await domainError(changeMemberRole(actor, 'nao-e-uuid', 'MANAGER'))).code).toBe('not_found')
  })
})

describe('resendInvite', () => {
  test('troca o convite anterior, manda e-mail novo e registra na auditoria', async () => {
    const m = await inviteMember(actor, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA)
    const velho = tokenDoEmail()
    await resendInvite(actor, m.membershipId, AGORA)
    const novo = tokenDoEmail()
    expect(novo).not.toBe(velho)
    expect(mail.sent).toHaveLength(2)
    const tokens = await prisma.userToken.findMany({ where: { userId: m.userId } })
    expect(tokens.map((t) => t.tokenHash)).toEqual([hashToken(novo)])
    expect(await prisma.auditLog.count({ where: { businessId, action: 'team.invite_resent' } })).toBe(1)
  })

  test('quem já tem senha ou está desativado não recebe convite: conflict', async () => {
    const { membership } = await novoVinculo('MANAGER')
    expect((await domainError(resendInvite(actor, membership.id, AGORA))).code).toBe('conflict')
    const m = await inviteMember(actor, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA)
    await prisma.membership.update({ where: { id: m.membershipId }, data: { active: false } })
    expect((await domainError(resendInvite(actor, m.membershipId, AGORA))).code).toBe('conflict')
  })
})

describe('autorização', () => {
  test('quem não é admin da plataforma recebe forbidden em toda função', async () => {
    const { membership } = await novoVinculo('MANAGER')
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    const dono: PlatformAdminActor = { kind: 'platform_admin', adminId: randomUUID(), name: 'x' }
    const chamadas = [
      () => listTeam(intruso, businessId),
      () => inviteMember(intruso, businessId, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA),
      () => changeMemberRole(intruso, membership.id, 'PROFESSIONAL'),
      () => setMemberActive(intruso, membership.id, false),
      () => resendInvite(intruso, membership.id, AGORA),
      () => setMemberActive(dono, membership.id, false),
    ]
    for (const c of chamadas) expect((await domainError(c())).code).toBe('forbidden')
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).active).toBe(true)
  })
})

describe('desativar o último vínculo ativo de quem ainda não tem senha', () => {
  const pendentes = (userId: string) => prisma.userToken.count({ where: { userId, purpose: 'INVITE', usedAt: null } })

  test('apaga os convites pendentes: o link antigo deixa de valer', async () => {
    const m = await inviteMember(actor, businessId, { name: 'Bia Souza', email: 'bia@exemplo.test', role: 'MANAGER' }, AGORA)
    expect(await pendentes(m.userId)).toBe(1)
    await setMemberActive(actor, m.membershipId, false, AGORA)
    expect(await pendentes(m.userId)).toBe(0)
  })
})

describe('uma loja por login da equipe (porta do admin)', () => {
  test('convidar quem é ativo em outra loja: conflict member_of_other_business e nada gravado; reativar também', async () => {
    const outra = (await makeBusiness({ name: 'Outra Loja' })).id
    const user = await makeUser({ email: 'ana@exemplo.test' })
    await makeMembership(outra, user.id, 'MANAGER')
    const e = await domainError(inviteMember(actor, businessId, { name: 'Ana', email: 'ana@exemplo.test', role: 'MANAGER' }, AGORA))
    expect(e).toMatchObject({ code: 'conflict', reason: 'member_of_other_business', message: OUTRA_LOJA_MESSAGE })
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1)
    const antigo = await prisma.membership.create({ data: { businessId, userId: user.id, role: 'MANAGER', active: false } })
    const r = await domainError(setMemberActive(actor, antigo.id, true, AGORA))
    expect(r).toMatchObject({ code: 'conflict', reason: 'member_of_other_business' })
  })
})
