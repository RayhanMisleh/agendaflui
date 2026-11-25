import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AuthError } from '@/server/auth/actor'
import { verifyPassword } from '@/server/auth/password'
import { personState } from '@/server/auth/person'
import {
  confirmEmailChange,
  getPersonAccount,
  requestEmailChange,
  setPersonPassword,
  setPersonPhone,
  switchStore,
  unlinkGoogle,
  updatePersonProfile,
} from '@/server/auth/person-account'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCalendarConnection, makeCustomer, makeMembership, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const mail = fakeMail()
const AGORA = new Date('2026-11-24T12:00:00.000Z')
const SENHA = 'senha-atual-bem-longa'
const GOOGLE = { sub: 'sub-123', email: 'rita@exemplo.test' }

beforeEach(async () => {
  await resetDb()
  mail.install()
})
afterEach(() => mail.uninstall())

const lerUser = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } })

async function sessao(userId: string, token: string) {
  return prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: addMinutes(AGORA, 600) } })
}

/** Pede a troca e roda a continuação (o que viria depois da resposta). */
async function pedir(userId: string, email: string, agora = AGORA): Promise<void> {
  await (await requestEmailChange(userId, { email }, agora))()
}

describe('dados', () => {
  test('nome e telefone mudam na pessoa e em todas as lojas em que ela é cliente', async () => {
    const u = await makeUser({ name: 'Rita Prado', email: 'rita@exemplo.test' })
    const a = await makeBusiness()
    const b = await makeBusiness()
    const ca = await makeCustomer(a.id, { userId: u.id, name: 'Rita Prado' })
    const cb = await makeCustomer(b.id, { userId: u.id, name: 'Rita Prado' })
    const outro = await makeCustomer(a.id, { name: 'Outra Pessoa' })
    await updatePersonProfile(u.id, { name: '  Rita Çardoso ', phone: '(11) 91234-5678' })
    expect(await lerUser(u.id)).toMatchObject({ name: 'Rita Çardoso', searchName: 'rita cardoso', phone: '5511912345678' })
    for (const id of [ca.id, cb.id]) {
      expect(await prisma.customer.findUniqueOrThrow({ where: { id } })).toMatchObject({
        name: 'Rita Çardoso',
        searchName: 'rita cardoso',
        phone: '5511912345678',
      })
    }
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: outro.id } })).name).toBe('Outra Pessoa')
  })

  test('telefone vazio limpa; telefone inválido e nome vazio são validação e nada muda', async () => {
    const u = await makeUser({ phone: '5511912345678' })
    await updatePersonProfile(u.id, { name: 'Rita', phone: '' })
    expect((await lerUser(u.id)).phone).toBeNull()
    const ruim = await domainError(updatePersonProfile(u.id, { name: 'Rita', phone: 'abc' }))
    expect(ruim.fields).toHaveProperty('phone')
    const vazio = await domainError(updatePersonProfile(u.id, { name: '  ' }))
    expect(vazio.fields).toHaveProperty('name')
    expect((await lerUser(u.id)).name).toBe('Rita')
  })
})

describe('telefone do cadastro', () => {
  test('grava só o telefone na pessoa e nas cópias dela, sem mexer no nome', async () => {
    const u = await makeUser({ name: 'Rita Prado' })
    const a = await makeBusiness()
    const c = await makeCustomer(a.id, { userId: u.id, name: 'Rita Prado' })
    await setPersonPhone(u.id, '(11) 91234-5678')
    expect(await lerUser(u.id)).toMatchObject({ name: 'Rita Prado', phone: '5511912345678' })
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ name: 'Rita Prado', phone: '5511912345678' })
  })

  test('telefone vazio ou inválido é validação e o que havia fica', async () => {
    const u = await makeUser({ phone: '5511912345678' })
    expect((await domainError(setPersonPhone(u.id, '   '))).fields).toHaveProperty('phone')
    expect((await domainError(setPersonPhone(u.id, 'abc'))).fields).toHaveProperty('phone')
    expect((await lerUser(u.id)).phone).toBe('5511912345678')
  })

  test('pessoa que não existe: não encontrada', async () => {
    const erro = await domainError(setPersonPhone('00000000-0000-4000-8000-000000000000', '(11) 91234-5678'))
    expect(erro.code).toBe('not_found')
  })
})

describe('senha', () => {
  test('só Google cria a primeira senha sem a atual', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    expect(u.passwordHash).toBeNull()
    await setPersonPassword(u.id, { next: 'primeira-senha-longa' }, 'x', AGORA)
    expect(await verifyPassword((await lerUser(u.id)).passwordHash ?? '', 'primeira-senha-longa')).toBe(true)
  })

  test('trocar senha exige a atual, derruba as outras sessões e mantém a atual', async () => {
    const u = await makeUser({ password: SENHA })
    const atual = await sessao(u.id, 'token-atual')
    const outra = await sessao(u.id, 'token-outro-aparelho')
    await prisma.userToken.create({ data: { userId: u.id, purpose: 'PASSWORD_RESET', tokenHash: hashToken('r'), expiresAt: addMinutes(AGORA, 60) } })
    const semAtual = await domainError(setPersonPassword(u.id, { next: 'senha-nova-bem-longa' }, 'token-atual', AGORA))
    expect(semAtual.fields).toHaveProperty('current')
    const errada = await domainError(setPersonPassword(u.id, { current: 'errada-errada-1', next: 'senha-nova-bem-longa' }, 'token-atual', AGORA))
    expect(errada.reason).toBe('wrong_password')
    const igual = await domainError(setPersonPassword(u.id, { current: SENHA, next: SENHA }, 'token-atual', AGORA))
    expect(igual.fields).toHaveProperty('next')
    await setPersonPassword(u.id, { current: SENHA, next: 'senha-nova-bem-longa' }, 'token-atual', AGORA)
    expect(await verifyPassword((await lerUser(u.id)).passwordHash ?? '', 'senha-nova-bem-longa')).toBe(true)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: atual.id } })).revokedAt).toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: outra.id } })).revokedAt).not.toBeNull()
    expect(await prisma.userToken.count({ where: { userId: u.id, purpose: 'PASSWORD_RESET', usedAt: null } })).toBe(0)
  })

  test('na 6ª tentativa errada a pessoa é barrada até com a senha certa', async () => {
    const u = await makeUser({ password: SENHA })
    for (let i = 0; i < 5; i++) {
      expect((await domainError(setPersonPassword(u.id, { current: 'errada-errada-1', next: 'senha-nova-bem-longa' }, 't', AGORA))).reason).toBe('wrong_password')
    }
    await expect(setPersonPassword(u.id, { current: SENHA, next: 'senha-nova-bem-longa' }, 't', AGORA)).rejects.toBeInstanceOf(AuthError)
    expect(await verifyPassword((await lerUser(u.id)).passwordHash ?? '', SENHA)).toBe(true)
  })
})

describe('Google (regras 7 e 9)', () => {
  test('regra 7: desvincular sem senha é recusado com "Crie uma senha antes de desvincular, para não perder o acesso."', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    const e = await domainError(unlinkGoogle(u.id, AGORA))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('needs_password')
    expect(e.message).toBe('Crie uma senha antes de desvincular, para não perder o acesso.')
    expect((await lerUser(u.id)).googleSub).toBe(GOOGLE.sub)
  })

  test('regra 7: desvincular com senha limpa sub, e-mail e data do Google; sem Google é not_found', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email, password: SENHA })
    await unlinkGoogle(u.id, AGORA)
    expect(await lerUser(u.id)).toMatchObject({ googleSub: null, googleEmail: null, googleLinkedAt: null })
    const e = await domainError(unlinkGoogle(u.id, AGORA))
    expect(e.code).toBe('not_found')
    expect(e.message).toBe('Nenhum Google vinculado.')
  })

  test('regra 9: trocar o e-mail com Google de outro e-mail desvincula o Google', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email, password: SENHA })
    await pedir(u.id, 'novo@exemplo.test')
    const r = await confirmEmailChange(u.id, { email: 'novo@exemplo.test', code: mail.codeOf() }, AGORA)
    expect(r.googleUnlinked).toBe(true)
    expect(await lerUser(u.id)).toMatchObject({
      email: 'novo@exemplo.test',
      emailVerifiedAt: AGORA,
      googleSub: null,
      googleEmail: null,
      googleLinkedAt: null,
    })
  })

  test('regra 9: trocar para o e-mail do próprio Google mantém o vínculo', async () => {
    const u = await makeUser({ google: GOOGLE, email: 'antigo@exemplo.test', password: SENHA })
    await pedir(u.id, 'RITA@exemplo.test')
    const r = await confirmEmailChange(u.id, { email: 'rita@exemplo.test', code: mail.codeOf() }, AGORA)
    expect(r.googleUnlinked).toBe(false)
    expect(await lerUser(u.id)).toMatchObject({ email: 'rita@exemplo.test', googleSub: GOOGLE.sub })
  })

  test('regra 9: só Google tentando outro e-mail: needs_password e nada muda (no pedido e na confirmação)', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    const e = await domainError(requestEmailChange(u.id, { email: 'novo@exemplo.test' }, AGORA))
    expect(e.reason).toBe('needs_password')
    expect(e.message).toBe('Crie uma senha antes de trocar o e-mail.')
    // Um código emitido antes da pessoa perder a senha não vale: a confirmação repete a checagem.
    await prisma.emailCode.deleteMany()
    const outraSenha = await makeUser({ password: SENHA })
    await pedir(outraSenha.id, 'x@exemplo.test')
    const codigo = mail.codeOf()
    await prisma.user.update({ where: { id: outraSenha.id }, data: { passwordHash: null, googleSub: 'sub-9', googleEmail: 'g@exemplo.test', googleLinkedAt: AGORA } })
    const e2 = await domainError(confirmEmailChange(outraSenha.id, { email: 'x@exemplo.test', code: codigo }, AGORA))
    expect(e2.reason).toBe('needs_password')
    expect((await lerUser(outraSenha.id)).email).not.toBe('x@exemplo.test')
    expect((await lerUser(u.id)).email).toBe(GOOGLE.email)
  })

  test('só Google pode pedir troca para o e-mail do próprio Google (o mesmo, vira "já é o seu e-mail")', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    const e = await domainError(requestEmailChange(u.id, { email: GOOGLE.email }, AGORA))
    expect(e.code).toBe('validation')
    expect(e.message).toBe('Este já é o seu e-mail.')
  })
})

describe('troca de e-mail', () => {
  test('atualiza a cópia em todas as lojas na mesma transação e verifica o e-mail', async () => {
    const u = await makeUser({ password: SENHA, email: 'velho@exemplo.test' })
    const a = await makeBusiness()
    const b = await makeBusiness()
    const ca = await makeCustomer(a.id, { userId: u.id })
    const cb = await makeCustomer(b.id, { userId: u.id })
    await pedir(u.id, 'Novo@Exemplo.test')
    expect(mail.sent).toHaveLength(1)
    const r = await confirmEmailChange(u.id, { email: 'novo@exemplo.test', code: mail.codeOf() }, AGORA)
    expect(r.googleUnlinked).toBe(false)
    expect(await lerUser(u.id)).toMatchObject({ email: 'novo@exemplo.test', emailVerifiedAt: AGORA })
    for (const id of [ca.id, cb.id]) expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).email).toBe('novo@exemplo.test')
  })

  test('o código vai para o e-mail novo; código errado conta tentativa e nada muda', async () => {
    const u = await makeUser({ password: SENHA, email: 'velho@exemplo.test' })
    await pedir(u.id, 'novo@exemplo.test')
    expect(mail.sent[0]?.to).toBe('novo@exemplo.test')
    const certo = mail.codeOf()
    const errado = certo === '000000' ? '111111' : '000000'
    const e = await domainError(confirmEmailChange(u.id, { email: 'novo@exemplo.test', code: errado }, AGORA))
    expect(e.reason).toBe('invalid_code')
    expect((await prisma.emailCode.findFirstOrThrow({ where: { subject: u.id } })).attempts).toBe(1)
    expect((await lerUser(u.id)).email).toBe('velho@exemplo.test')
    // O código de outro e-mail não vale para este.
    const e2 = await domainError(confirmEmailChange(u.id, { email: 'outro@exemplo.test', code: certo }, AGORA))
    expect(e2.reason).toBe('invalid_code')
    await confirmEmailChange(u.id, { email: 'novo@exemplo.test', code: certo }, AGORA)
    expect((await lerUser(u.id)).email).toBe('novo@exemplo.test')
  })

  test('mesmo e-mail é validação; e-mail inválido também', async () => {
    const u = await makeUser({ password: SENHA, email: 'velho@exemplo.test' })
    const igual = await domainError(requestEmailChange(u.id, { email: 'VELHO@exemplo.test' }, AGORA))
    expect(igual.message).toBe('Este já é o seu e-mail.')
    const ruim = await domainError(requestEmailChange(u.id, { email: 'sem-arroba' }, AGORA))
    expect(ruim.fields).toHaveProperty('email')
  })

  test('e-mail de outra pessoa: email_taken e nada muda', async () => {
    const u = await makeUser({ password: SENHA, email: 'velho@exemplo.test' })
    await makeUser({ email: 'ocupado@exemplo.test' })
    const loja = await makeBusiness()
    const c = await makeCustomer(loja.id, { userId: u.id })
    await pedir(u.id, 'ocupado@exemplo.test')
    const e = await domainError(confirmEmailChange(u.id, { email: 'ocupado@exemplo.test', code: mail.codeOf() }, AGORA))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('email_taken')
    expect(e.message).toBe('Este e-mail já tem conta no Agenda Flui.')
    expect((await lerUser(u.id)).email).toBe('velho@exemplo.test')
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).email).toBe('velho@exemplo.test')
  })

  test('e-mail de cliente de balcão numa loja da pessoa: customer_email_taken e nada muda', async () => {
    const u = await makeUser({ password: SENHA, email: 'velho@exemplo.test' })
    const minha = await makeBusiness()
    const outra = await makeBusiness()
    const meu = await makeCustomer(minha.id, { userId: u.id })
    await makeCustomer(minha.id, { email: 'balcao@exemplo.test', name: 'Balcão' })
    // Balcão com o mesmo e-mail numa loja onde a pessoa NÃO é cliente não atrapalha.
    await makeCustomer(outra.id, { email: 'livre@exemplo.test', name: 'Outro balcão' })
    await pedir(u.id, 'balcao@exemplo.test')
    const e = await domainError(confirmEmailChange(u.id, { email: 'balcao@exemplo.test', code: mail.codeOf() }, AGORA))
    expect(e.reason).toBe('customer_email_taken')
    expect(e.message).toBe('Este e-mail já está no cadastro de outro cliente numa loja sua. Fale com a loja.')
    expect((await lerUser(u.id)).email).toBe('velho@exemplo.test')
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: meu.id } })).email).toBe('velho@exemplo.test')
    await pedir(u.id, 'livre@exemplo.test')
    await confirmEmailChange(u.id, { email: 'livre@exemplo.test', code: mail.codeOf() }, AGORA)
    expect((await lerUser(u.id)).email).toBe('livre@exemplo.test')
  })
})

describe('lojas', () => {
  test('trocar de loja só para loja em que é cliente', async () => {
    const u = await makeUser({ password: SENHA })
    const a = await makeBusiness({ slug: 'loja-a' })
    const b = await makeBusiness({ slug: 'loja-b' })
    const c = await makeBusiness({ slug: 'loja-c' })
    await makeCustomer(a.id, { userId: u.id })
    await makeCustomer(b.id, { userId: u.id })
    await sessao(u.id, 'tok')
    expect(await switchStore('tok', u.id, b.id)).toEqual({ slug: 'loja-b' })
    expect((await prisma.session.findFirstOrThrow({ where: { tokenHash: hashToken('tok') } })).customerBusinessId).toBe(b.id)
    const e = await domainError(switchStore('tok', u.id, c.id))
    expect(e.code).toBe('not_found')
    expect(e.message).toBe('Escolha uma das suas lojas.')
    expect((await prisma.session.findFirstOrThrow({ where: { tokenHash: hashToken('tok') } })).customerBusinessId).toBe(b.id)
  })
})

describe('getPersonAccount', () => {
  test('cliente de duas lojas: lojas com a atual marcada, Google e senha', async () => {
    const u = await makeUser({ password: SENHA, name: 'Rita', email: 'rita@exemplo.test', phone: '5511912345678' })
    const a = await makeBusiness({ slug: 'loja-a', name: 'Loja A' })
    const b = await makeBusiness({ slug: 'loja-b', name: 'Loja B' })
    await makeCustomer(a.id, { userId: u.id })
    await makeCustomer(b.id, { userId: u.id })
    const v = await getPersonAccount(u.id, b.id)
    expect(v).toMatchObject({ name: 'Rita', email: 'rita@exemplo.test', phone: '5511912345678', phoneLabel: '(11) 91234-5678', hasPassword: true, google: null, googleAvailable: false, staff: null })
    expect(v.stores.map((s) => [s.slug, s.current])).toEqual([['loja-a', false], ['loja-b', true]])
  })

  test('equipe: papel e chave de avisos; profissional não vê a chave; só Google mostra o e-mail do Google', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    const loja = await makeBusiness({ name: 'Loja Central' })
    await prisma.businessBranding.update({ where: { businessId: loja.id }, data: { displayName: 'Loja Central' } })
    const m = await makeMembership(loja.id, u.id, 'MANAGER')
    await prisma.membership.update({ where: { id: m.id }, data: { notifyAllAppointments: true } })
    const v = await getPersonAccount(u.id, null)
    expect(v.hasPassword).toBe(false)
    expect(v.google).toMatchObject({ email: GOOGLE.email })
    expect(v.staff).toEqual({ businessName: 'Loja Central', roleLabel: 'Gerente', canWatchAll: true, watchAll: true })
    await prisma.membership.update({ where: { id: m.id }, data: { role: 'PROFESSIONAL' } })
    expect((await getPersonAccount(u.id, null)).staff).toMatchObject({ roleLabel: 'Profissional', canWatchAll: false })
  })
})

describe('invariante', () => {
  test('nenhuma ação de Minha conta deixa a pessoa sem senha e sem Google', async () => {
    const u = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    const ativa = async () => personState(await lerUser(u.id)) === 'active'
    // Só Google: desvincular e trocar e-mail são recusados.
    await domainError(unlinkGoogle(u.id, AGORA))
    expect(await ativa()).toBe(true)
    await domainError(requestEmailChange(u.id, { email: 'novo@exemplo.test' }, AGORA))
    expect(await ativa()).toBe(true)
    // Cria a senha: agora desvincular e trocar o e-mail passam e a pessoa segue ativa (com senha).
    await setPersonPassword(u.id, { next: 'primeira-senha-longa' }, 'x', AGORA)
    expect(await ativa()).toBe(true)
    await pedir(u.id, 'novo@exemplo.test')
    expect((await confirmEmailChange(u.id, { email: 'novo@exemplo.test', code: mail.codeOf() }, AGORA)).googleUnlinked).toBe(true)
    expect(await ativa()).toBe(true)
    expect((await lerUser(u.id)).passwordHash).not.toBeNull()
    await updatePersonProfile(u.id, { name: 'Novo Nome' })
    expect(await ativa()).toBe(true)
  })
})

describe('getPersonAccount: Google Agenda', () => {
  test('calendar é null para cliente e traz o estado para a equipe', async () => {
    const cliente = await makeUser({ password: SENHA })
    expect((await getPersonAccount(cliente.id, null)).calendar).toBeNull()

    const b = await makeBusiness()
    const membro = await makeUser({ password: SENHA, google: GOOGLE })
    await makeMembership(b.id, membro.id, 'PROFESSIONAL')
    expect((await getPersonAccount(membro.id, null)).calendar).toMatchObject({ state: 'off', hasGoogle: true, syncedLabel: null })

    await makeCalendarConnection(membro.id)
    await prisma.calendarConnection.update({ where: { userId: membro.id }, data: { lastSyncedAt: new Date('2026-11-24T15:30:00Z') } })
    expect((await getPersonAccount(membro.id, null)).calendar).toMatchObject({ state: 'on', syncedLabel: '24/11/2026 12:30' })

    const semGoogle = await makeUser({ password: SENHA })
    await makeMembership(b.id, semGoogle.id, 'PROFESSIONAL')
    expect((await getPersonAccount(semGoogle.id, null)).calendar).toMatchObject({ hasGoogle: false, available: false })
  })

  test('troca de e-mail apaga links de redefinição abertos e derruba as outras sessões, menos a atual', async () => {
    const u = await makeUser({ email: 'velho@exemplo.test', password: SENHA })
    await prisma.userToken.create({ data: { userId: u.id, purpose: 'PASSWORD_RESET', tokenHash: hashToken('link'), expiresAt: addMinutes(AGORA, 60) } })
    await sessao(u.id, 'atual')
    await sessao(u.id, 'outra')
    await pedir(u.id, 'novo@exemplo.test')
    await confirmEmailChange(u.id, { email: 'novo@exemplo.test', code: mail.codeOf() }, AGORA, 'atual')
    expect(await prisma.userToken.count({ where: { userId: u.id, purpose: 'PASSWORD_RESET' } })).toBe(0)
    expect((await prisma.session.findFirstOrThrow({ where: { tokenHash: hashToken('atual') } })).revokedAt).toBeNull()
    expect((await prisma.session.findFirstOrThrow({ where: { tokenHash: hashToken('outra') } })).revokedAt).not.toBeNull()
  })

  test('pedidos de código de troca têm teto por pessoa, mesmo com e-mails novos diferentes', async () => {
    const u = await makeUser({ email: 'velho@exemplo.test', password: SENHA })
    for (let n = 0; n < 5; n++) await requestEmailChange(u.id, { email: `n${n}@exemplo.test` }, AGORA)
    await expect(requestEmailChange(u.id, { email: 'n9@exemplo.test' }, AGORA)).rejects.toBeInstanceOf(AuthError)
  })
})
