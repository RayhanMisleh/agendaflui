import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AuthError } from '@/server/auth/actor'
import { loginUser } from '@/server/auth/member-auth'
import { verifyPassword } from '@/server/auth/password'
import { checkPanelResetLimit, readPanelPasswordReset, requestPanelPasswordReset, resetPanelPassword } from '@/server/auth/password-reset'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { changeAccessRole } from '@/server/domain/team/access'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeMembership, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const AGORA = new Date('2026-11-17T12:00:00.000Z')
const META = { ip: '203.0.113.7' }
const mail = fakeMail()
let businessId: string

beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ name: 'Barbearia Central' })).id
  mail.install()
})
afterEach(() => mail.uninstall())

function tokenDoEmail(i = mail.sent.length - 1): string {
  const m = /\/redefinir-senha\/([A-Za-z0-9_-]+)/.exec(mail.sent[i]?.text ?? '')
  if (!m?.[1]) throw new Error('O e-mail não traz o link de redefinição.')
  return m[1]
}

async function pedir(email: string, now = AGORA, meta: { ip?: string } = META): Promise<void> {
  const continuacao = await requestPanelPasswordReset(email, meta, now)
  await continuacao()
}

async function pessoa(o: { role?: 'OWNER' | 'PROFESSIONAL'; password?: string | null; active?: boolean; business?: string } = {}) {
  const user = await makeUser({ password: o.password === undefined ? 'senha-antiga-1' : o.password })
  const membership = await makeMembership(o.business ?? businessId, user.id, o.role ?? 'OWNER')
  if (o.active === false) await prisma.membership.update({ where: { id: membership.id }, data: { active: false } })
  return { user, membership }
}

async function emitido(email: string, now = AGORA): Promise<string> {
  await pedir(email, now)
  return tokenDoEmail()
}

describe('requestPanelPasswordReset', () => {
  test('e-mail que existe e e-mail que não existe: mesma resposta, nada acontece antes da continuação, e só o existente recebe e-mail', async () => {
    const { user } = await pessoa()
    const existente = await requestPanelPasswordReset(user.email, META, AGORA)
    const inexistente = await requestPanelPasswordReset('ninguem@exemplo.test', META, AGORA)
    expect(typeof existente).toBe('function')
    expect(typeof inexistente).toBe('function')
    // Antes da continuação: nem limite contado, nem token emitido, nem e-mail.
    expect(await prisma.rateLimitBucket.count()).toBe(0)
    expect(await prisma.userToken.count()).toBe(0)
    expect(mail.sent).toHaveLength(0)
    await Promise.all([existente(), inexistente()])
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]).toMatchObject({ to: user.email })
    expect(mail.sent[0]?.text).toContain('/redefinir-senha/')
    expect(await prisma.userToken.count()).toBe(1)
  })

  test('e-mail mal formado é 422 igual para qualquer caso, antes de tocar no banco', async () => {
    const { user } = await pessoa()
    for (const ruim of ['', 'sem-arroba', 'a@b', `${'x'.repeat(250)}@exemplo.test`, 'a@b.test, c@d.test']) {
      const e = await domainError(requestPanelPasswordReset(ruim, META, AGORA))
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty('email')
    }
    expect(await prisma.rateLimitBucket.count()).toBe(0)
    await pedir(user.email.toUpperCase())
    expect(mail.sent).toHaveLength(1)
  })

  test('o link usa o host do painel, o token vale 60 minutos e no banco só fica o hash', async () => {
    const { user } = await pessoa()
    const token = await emitido(user.email)
    expect(mail.sent[0]?.text).toContain(`/redefinir-senha/${token}`)
    const linha = await prisma.userToken.findFirstOrThrow({ where: { userId: user.id } })
    expect(linha).toMatchObject({ purpose: 'PASSWORD_RESET', tokenHash: hashToken(token), usedAt: null, expiresAt: addMinutes(AGORA, 60) })
    expect(JSON.stringify(linha)).not.toContain(token)
    expect(token.length).toBeGreaterThanOrEqual(43)
  })

  test('um token vivo por usuário: o pedido novo invalida o anterior', async () => {
    const { user } = await pessoa()
    const primeiro = await emitido(user.email)
    const segundo = await emitido(user.email, addMinutes(AGORA, 1))
    expect(segundo).not.toBe(primeiro)
    expect(await readPanelPasswordReset(primeiro, AGORA)).toBeNull()
    expect(await readPanelPasswordReset(segundo, AGORA)).toEqual({ email: user.email })
    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(1)
  })

  test('o 4º pedido em 15 minutos não envia; passada a janela volta a enviar; teto de 6 por dia', async () => {
    const { user } = await pessoa()
    for (let i = 0; i < 4; i++) await pedir(user.email, addMinutes(AGORA, i))
    expect(mail.sent).toHaveLength(3)
    await pedir(user.email, addMinutes(AGORA, 16))
    expect(mail.sent).toHaveLength(4)
    await pedir(user.email, addMinutes(AGORA, 32))
    await pedir(user.email, addMinutes(AGORA, 48))
    expect(mail.sent).toHaveLength(6)
    await pedir(user.email, addMinutes(AGORA, 64))
    expect(mail.sent).toHaveLength(6)
  })

  test('o limite por origem (IP) barra pedidos de e-mails diferentes e não consome o do e-mail', async () => {
    const alvo = await pessoa()
    for (let i = 0; i < 12; i++) await pedir(`x${i}@exemplo.test`, AGORA, { ip: '198.51.100.9' })
    await pedir(alvo.user.email, AGORA, { ip: '198.51.100.9' })
    expect(mail.sent).toHaveLength(0)
    await pedir(alvo.user.email, AGORA, { ip: '198.51.100.10' })
    expect(mail.sent).toHaveLength(1)
  })

  test('sem IP confiável os limites por e-mail continuam valendo', async () => {
    const { user } = await pessoa()
    for (let i = 0; i < 4; i++) await pedir(user.email, AGORA, {})
    expect(mail.sent).toHaveLength(3)
  })

  test('quem não tem nenhum vínculo ativo não recebe e-mail nem token', async () => {
    const semVinculo = await makeUser()
    const desativado = await pessoa({ active: false })
    const arquivada = await makeBusiness({ status: 'ARCHIVED' })
    const naArquivada = await pessoa({ business: arquivada.id })
    for (const email of [semVinculo.email, desativado.user.email, naArquivada.user.email]) await pedir(email)
    expect(mail.sent).toHaveLength(0)
    expect(await prisma.userToken.count()).toBe(0)
  })

  test('quem ainda não definiu a senha (convite pendente) recebe o convite de novo, nunca um link que defina senha por redefinição', async () => {
    const { user } = await pessoa({ password: null })
    await pedir(user.email)
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]?.text).toContain('/definir-senha/')
    expect(mail.sent[0]?.text).not.toContain('/redefinir-senha/')
    expect(await prisma.userToken.findMany({ where: { userId: user.id } })).toMatchObject([{ purpose: 'INVITE' }])
  })

  test('falha no envio não vira erro nem vaza o link no log', async () => {
    const { user } = await pessoa()
    mail.failing = true
    await expect(pedir(user.email)).resolves.toBeUndefined()
    expect(mail.failed).toHaveLength(1)
  })
})

describe('readPanelPasswordReset', () => {
  test('devolve o e-mail do token vivo; desconhecido, vencido (61 min), usado e de outro propósito dão null', async () => {
    const { user } = await pessoa()
    const token = await emitido(user.email)
    expect(await readPanelPasswordReset(token, addMinutes(AGORA, 59))).toEqual({ email: user.email })
    expect(await readPanelPasswordReset(token, addMinutes(AGORA, 61))).toBeNull()
    expect(await readPanelPasswordReset('lixo', AGORA)).toBeNull()
    expect(await readPanelPasswordReset('', AGORA)).toBeNull()
    await prisma.userToken.updateMany({ where: { userId: user.id }, data: { usedAt: AGORA } })
    expect(await readPanelPasswordReset(token, AGORA)).toBeNull()
    await prisma.userToken.create({ data: { userId: user.id, purpose: 'INVITE', tokenHash: hashToken('convite'), expiresAt: addMinutes(AGORA, 60) } })
    expect(await readPanelPasswordReset('convite', AGORA)).toBeNull()
  })
})

describe('resetPanelPassword', () => {
  test('troca a senha, o token não serve duas vezes e a pessoa entra com a nova', async () => {
    const { user } = await pessoa()
    const token = await emitido(user.email)
    await resetPanelPassword({ token, password: 'senha-nova-bem-longa' }, META, addMinutes(AGORA, 5))
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword(depois.passwordHash ?? '', 'senha-nova-bem-longa')).toBe(true)
    expect(await verifyPassword(depois.passwordHash ?? '', 'senha-antiga-1')).toBe(false)
    expect(depois.passwordHash).not.toContain('senha-nova')
    const e = await domainError(resetPanelPassword({ token, password: 'outra-senha-bem-longa' }, META, addMinutes(AGORA, 6)))
    expect(e.code).toBe('not_found')
    expect(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash ?? '', 'senha-nova-bem-longa')).toBe(true)
    const sessao = await loginUser({ email: user.email, password: 'senha-nova-bem-longa' })
    expect(sessao.session.user.id).toBe(user.id)
  })

  test('vencido (61 min), desconhecido e de outro propósito falham com a mesma mensagem', async () => {
    const { user } = await pessoa()
    const token = await emitido(user.email)
    await prisma.userToken.create({ data: { userId: user.id, purpose: 'INVITE', tokenHash: hashToken('convite'), expiresAt: addMinutes(AGORA, 60) } })
    const erros = [
      await domainError(resetPanelPassword({ token, password: 'senha-nova-bem-longa' }, META, addMinutes(AGORA, 61))),
      await domainError(resetPanelPassword({ token: 'lixo', password: 'senha-nova-bem-longa' }, META, AGORA)),
      await domainError(resetPanelPassword({ token: 'convite', password: 'senha-nova-bem-longa' }, META, AGORA)),
    ]
    for (const e of erros) expect(e.code).toBe('not_found')
    expect(new Set(erros.map((e) => e.message)).size).toBe(1)
    expect(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash ?? '', 'senha-antiga-1')).toBe(true)
  })

  test('senha curta é validação e não consome o token', async () => {
    const { user } = await pessoa()
    const token = await emitido(user.email)
    const e = await domainError(resetPanelPassword({ token, password: 'curta' }, META, AGORA))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('password')
    expect(await readPanelPasswordReset(token, AGORA)).toEqual({ email: user.email })
  })

  test('o token de uma pessoa nunca altera a senha de outra', async () => {
    const a = await pessoa()
    const b = await pessoa()
    const tokenA = await emitido(a.user.email)
    await resetPanelPassword({ token: tokenA, password: 'senha-nova-bem-longa' }, META, AGORA)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } })).passwordHash).toBe(b.user.passwordHash)
  })

  test('duas redefinições simultâneas com o mesmo token: uma passa e a outra recebe not_found', async () => {
    const { user } = await pessoa()
    const token = await emitido(user.email)
    const r = await Promise.allSettled([
      resetPanelPassword({ token, password: 'senha-nova-um-1234' }, META, AGORA),
      resetPanelPassword({ token, password: 'senha-nova-dois-1234' }, META, AGORA),
    ])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const falha = r.find((x) => x.status === 'rejected')
    expect(falha?.status === 'rejected' && (falha.reason as { code?: string }).code).toBe('not_found')
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash ?? ''
    expect([await verifyPassword(hash, 'senha-nova-um-1234'), await verifyPassword(hash, 'senha-nova-dois-1234')].filter(Boolean)).toHaveLength(1)
  })

  test('derruba todas as sessões do painel da pessoa (de qualquer conta) e os tokens do app de todos os vínculos; os dos outros ficam', async () => {
    const outra = (await makeBusiness()).id
    const { user, membership } = await pessoa()
    const segundoVinculo = await makeMembership(outra, user.id, 'PROFESSIONAL')
    const inativo = await makeMembership((await makeBusiness()).id, user.id, 'PROFESSIONAL')
    await prisma.membership.update({ where: { id: inativo.id }, data: { active: false } })
    const sessoes = await Promise.all(
      [businessId, outra, null].map((b) =>
        prisma.session.create({ data: { userId: user.id, activeBusinessId: b, tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600) } }),
      ),
    )
    const tokens = await Promise.all(
      [
        { b: businessId, m: membership.id },
        { b: outra, m: segundoVinculo.id },
        { b: inativo.businessId, m: inativo.id },
      ].map((x) =>
        prisma.refreshToken.create({
          data: { businessId: x.b, subject: 'MEMBER', membershipId: x.m, familyId: randomUUID(), tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600) },
        }),
      ),
    )
    const colega = await pessoa({ role: 'PROFESSIONAL' })
    const sessaoColega = await prisma.session.create({
      data: { userId: colega.user.id, activeBusinessId: businessId, tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600) },
    })
    const tokenColega = await prisma.refreshToken.create({
      data: { businessId, subject: 'MEMBER', membershipId: colega.membership.id, familyId: randomUUID(), tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600) },
    })
    const token = await emitido(user.email)
    await resetPanelPassword({ token, password: 'senha-nova-bem-longa' }, META, addMinutes(AGORA, 2))
    for (const s of sessoes) expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).revokedAt).not.toBeNull()
    for (const t of tokens) expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: t.id } })).revokedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessaoColega.id } })).revokedAt).toBeNull()
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: tokenColega.id } })).revokedAt).toBeNull()
  })

  test('quem perdeu todos os vínculos ativos depois do pedido não consegue usar o link', async () => {
    const { user, membership } = await pessoa()
    const token = await emitido(user.email)
    await prisma.membership.update({ where: { id: membership.id }, data: { active: false } })
    expect(await readPanelPasswordReset(token, AGORA)).toBeNull()
    expect((await domainError(resetPanelPassword({ token, password: 'senha-nova-bem-longa' }, META, AGORA))).code).toBe('not_found')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash)
  })

  test('uma redefinição em andamento e uma troca de papel no mesmo vínculo não travam uma à outra', async () => {
    const { user, membership } = await pessoa({ role: 'PROFESSIONAL' })
    const token = await emitido(user.email)
    const dono = await ctxWithRole({ id: businessId }, 'OWNER', { now: AGORA })
    const r = await Promise.allSettled([
      resetPanelPassword({ token, password: 'senha-nova-bem-longa' }, META, AGORA),
      changeAccessRole(dono, membership.id, 'MANAGER'),
    ])
    expect(r.every((x) => x.status === 'fulfilled')).toBe(true)
  })
})

describe('checkPanelResetLimit', () => {
  test('conta as tentativas de redefinir por IP e barra a 31ª; sem IP, conta por token', async () => {
    for (let i = 0; i < 30; i++) await checkPanelResetLimit('203.0.113.50', 't', AGORA)
    await expect(checkPanelResetLimit('203.0.113.50', 't', AGORA)).rejects.toBeInstanceOf(AuthError)
    await expect(checkPanelResetLimit('203.0.113.51', 't', AGORA)).resolves.toBeUndefined()
    for (let i = 0; i < 30; i++) await checkPanelResetLimit(undefined, 'abc', AGORA)
    await expect(checkPanelResetLimit(undefined, 'abc', AGORA)).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(checkPanelResetLimit(undefined, 'outro', AGORA)).resolves.toBeUndefined()
  })
})
