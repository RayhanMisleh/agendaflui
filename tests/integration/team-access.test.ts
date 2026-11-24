import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
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
import { ctxWithRole, makeBusiness, makeCtx, makeCustomer, makeMembership, makePlatformAdmin, makeProfessional, makeService, makeUser } from '../setup/factories'
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

describe('revogação', () => {
  test('desativar derruba as sessões do painel daquele vínculo; outras contas e pessoas ficam; reativar não devolve', async () => {
    const outra = (await makeBusiness()).id
    const alvo = await vinculo('PROFESSIONAL')
    const sessaoAqui = await novaSessao(alvo.user.id, businessId)
    const sessaoOutra = await novaSessao(alvo.user.id, outra)
    const colega = await vinculo('PROFESSIONAL')
    const sessaoColega = await novaSessao(colega.user.id, businessId)

    await setAccessActive(dono, alvo.membership.id, false)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoAqui.id } })).revokedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoOutra.id } })).revokedAt).toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoColega.id } })).revokedAt).toBeNull()

    await setAccessActive(dono, alvo.membership.id, true)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoAqui.id } })).revokedAt).not.toBeNull()
  })

  test('rebaixar derruba as sessões; promover não', async () => {
    const alvo = await vinculo('MANAGER')
    const sessao = await novaSessao(alvo.user.id, businessId)
    await changeAccessRole(dono, alvo.membership.id, 'OWNER')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).toBeNull()
    await changeAccessRole(dono, alvo.membership.id, 'PROFESSIONAL')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).not.toBeNull()
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
    const velho = linkToken('/convite', mail.sent[0]?.text ?? '')
    await resendAccessInvite(dono, m.membershipId)
    const novo = linkToken('/convite', mail.sent[1]?.text ?? '')
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
    expect(lista.find((x) => x.membershipId === m.id)).toMatchObject({ active: false, hasAccount: true, professionalId: ficha.id, lastLoginAt: AGORA })
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

  test('hasAccount é "convite pendente" desta conta: falso só para convite emitido por ela a quem ainda não tem senha', async () => {
    const pendente = await inviteAccess(dono, { name: 'Bia', email: 'bia@exemplo.test', role: 'MANAGER' })
    expect(pendente.hasAccount).toBe(false)
    expect((await listAccess(dono)).find((x) => x.membershipId === pendente.membershipId)?.hasAccount).toBe(false)
    expect((await resendAccessInvite(dono, pendente.membershipId), (await listAccess(dono)).find((x) => x.membershipId === pendente.membershipId)?.hasAccount)).toBe(false)
    const comSenha = await vinculo('PROFESSIONAL')
    expect((await listAccess(dono)).find((x) => x.membershipId === comSenha.membership.id)?.hasAccount).toBe(true)
    await prisma.user.update({ where: { id: pendente.userId }, data: { passwordHash: comSenha.user.passwordHash, emailVerifiedAt: AGORA } })
    expect((await listAccess(dono)).find((x) => x.membershipId === pendente.membershipId)?.hasAccount).toBe(true)
  })

  test('convite para e-mail de pessoa ativa (já cliente): vínculo ativo, sem convite, e-mail "Você entrou para a equipe da loja X. Entre com a sua conta."', async () => {
    const outraLoja = await makeBusiness()
    const cliente = await makeUser({ email: 'clara@exemplo.test', password: 'senha-da-clara-1' })
    await makeCustomer(outraLoja.id, { userId: cliente.id })
    const m = await inviteAccess(dono, { name: 'Clara', email: 'clara@exemplo.test', role: 'PROFESSIONAL' })
    expect(m).toMatchObject({ userId: cliente.id, active: true, hasAccount: true })
    expect(await prisma.userToken.count({ where: { userId: cliente.id } })).toBe(0)
    const enviados = mailTo('clara@exemplo.test')
    expect(enviados).toHaveLength(1)
    expect(enviados[0]?.text).toContain('Você entrou para a equipe da loja Barbearia Central. Entre com a sua conta.')
    expect(enviados[0]?.text).not.toContain('/convite/')
    // Continua cliente da outra loja: a pessoa é uma só.
    expect(await prisma.customer.count({ where: { userId: cliente.id } })).toBe(1)
  })

  test('convite para pessoa só com Google também não gera convite', async () => {
    const g = await makeUser({ email: 'gui@exemplo.test', password: null, google: { sub: 'sub-gui', email: 'gui@exemplo.test' } })
    const m = await inviteAccess(dono, { name: 'Gui', email: 'gui@exemplo.test', role: 'MANAGER' })
    expect(m).toMatchObject({ userId: g.id, hasAccount: true })
    expect(await prisma.userToken.count({ where: { userId: g.id } })).toBe(0)
  })

  test('a regra de um vínculo ativo por pessoa continua (OUTRA_LOJA_MESSAGE)', async () => {
    const outra = (await makeBusiness()).id
    const u = await makeUser({ email: 'dani@exemplo.test' })
    await makeMembership(outra, u.id, 'PROFESSIONAL')
    const e = await domainError(inviteAccess(dono, { name: 'Dani', email: 'dani@exemplo.test', role: 'PROFESSIONAL' }))
    expect(e.message).toBe(OUTRA_LOJA_MESSAGE)
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
    expect(m).toMatchObject({ name: 'Duda Lima', email: 'duda@exemplo.test', role: 'PROFESSIONAL', active: true, hasAccount: false, inviteMailFailed: false })
    expect(m.professionalId).not.toBeNull()
    const vinculo = await membroDe('duda@exemplo.test')
    expect(vinculo.professionals).toHaveLength(1)
    const ficha = await prisma.professional.findUniqueOrThrow({ where: { id: m.professionalId ?? '' }, include: { services: true } })
    expect(ficha).toMatchObject({ name: 'Duda Lima', membershipId: vinculo.id, commissionBps: 0, active: true })
    expect(ficha.displayOrder).toBeGreaterThan(antes.displayOrder)
    expect(ficha.services.map((s) => s.serviceId)).toEqual([servico.id])
    expect(mailTo('duda@exemplo.test')).toHaveLength(1)
    expect(mailTo('duda@exemplo.test')[0]?.text).toContain('/convite/')
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
