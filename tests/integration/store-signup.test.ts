import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { setAfterScheduler } from '@/server/after'
import { generateToken } from '@/server/auth/tokens'
import { getPersonSession } from '@/server/auth/session'
import { verifyPassword } from '@/server/auth/password'
import { confirmStoreSignup, requestStoreSignup, signInAtStore } from '@/server/auth/store-signup'
import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const mail = fakeMail()
const AGORA = new Date('2026-11-23T12:00:00.000Z')
const META = { ip: '203.0.113.9' }
const SENHA = 'senha-bem-longa'

let slug: string
let businessId: string
beforeEach(async () => {
  await resetDb()
  mail.install()
  setAfterScheduler(undefined)
  const b = await makeBusiness({ slug: 'pet-bom' })
  slug = b.slug
  businessId = b.id
})
afterEach(() => {
  mail.uninstall()
})

const dados = (o: Partial<{ name: string; email: string; phone: string; password: string }> = {}) => ({
  name: 'Ana Souza',
  email: 'ana@exemplo.test',
  phone: '(11) 91234-5678',
  password: SENHA,
  ...o,
})

/** Pede o cadastro e roda a continuação (o que viria depois da resposta). */
async function pedir(s: string, i = dados(), agora = AGORA): Promise<void> {
  await (await requestStoreSignup(s, i, META, agora))()
}

async function erro(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError)
    return e as DomainError
  }
  throw new Error('Era esperado um erro.')
}

describe('cadastro novo', () => {
  test('código por e-mail; pessoa verificada, cliente ligado, sessão na loja', async () => {
    await pedir(slug)
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]?.to).toBe('ana@exemplo.test')
    // Nada foi criado antes do código.
    expect(await prisma.user.count()).toBe(0)
    const r = await confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: mail.codeOf() }, META, AGORA)
    expect(r.join.kind).toBe('joined')
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@exemplo.test' } })
    expect(u).toMatchObject({ name: 'Ana Souza', phone: '5511912345678', emailVerifiedAt: AGORA })
    expect(await verifyPassword(u.passwordHash ?? '', SENHA)).toBe(true)
    const c = await prisma.customer.findFirstOrThrow({ where: { businessId } })
    expect(c).toMatchObject({ userId: u.id, email: 'ana@exemplo.test', origin: 'APP' })
    expect(await getPersonSession(r.token, AGORA)).toMatchObject({ kind: 'person', user: { id: u.id }, customerBusinessId: businessId })
  })

  test('o código vai em hash: a senha nunca fica no banco em texto', async () => {
    await pedir(slug)
    const linha = await prisma.emailCode.findFirstOrThrow()
    expect(JSON.stringify(linha)).not.toContain(SENHA)
    expect(linha.codeHash).not.toContain(mail.codeOf())
    expect(linha).toMatchObject({ purpose: 'SIGNUP', subject: businessId, email: 'ana@exemplo.test' })
  })

  test('adota o cliente de balcão com o mesmo e-mail', async () => {
    const balcao = await makeCustomer(businessId, { name: 'Ana da Loja', email: 'ana@exemplo.test', notes: 'VIP' })
    await pedir(slug)
    const r = await confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: mail.codeOf() }, META, AGORA)
    expect(r.join).toEqual({ kind: 'adopted', customerId: balcao.id })
    expect(await prisma.customer.count({ where: { businessId } })).toBe(1)
  })

  test('dados inválidos: validation com o campo certo e nada enviado', async () => {
    const e = await erro(requestStoreSignup(slug, dados({ password: 'curta', email: 'x' }), META, AGORA))
    expect(e.code).toBe('validation')
    expect(e.fields?.['password']).toBeDefined()
    expect(e.fields?.['email']).toBeDefined()
    expect(mail.sent).toHaveLength(0)
  })
})

describe('e-mail que já tem conta', () => {
  test('conta ativa: mesma resposta, nenhum código, e-mail "Este e-mail já tem conta. Entre com ela."', async () => {
    await makeUser({ email: 'ana@exemplo.test', name: 'Ana Antiga' })
    await pedir(slug)
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]?.text).toContain('Este e-mail já tem conta. Entre com ela.')
    expect(mail.sent[0]?.text).toContain('/pet-bom/entrar')
    expect(mail.sent[0]?.text).not.toMatch(/\b\d{6}\b/)
    expect(await prisma.emailCode.count()).toBe(0)
  })

  test('conta ativa com o código de um pedido anterior: conflito "email_taken", sem segunda conta', async () => {
    await pedir(slug)
    const code = mail.codeOf()
    await makeUser({ email: 'ana@exemplo.test' })
    const e = await erro(confirmStoreSignup(slug, { email: 'ana@exemplo.test', code }, META, AGORA))
    expect(e).toMatchObject({ code: 'conflict', reason: 'email_taken', message: 'Este e-mail já tem conta. Entre com ela.' })
    expect(await prisma.user.count()).toBe(1)
    expect(await prisma.customer.count()).toBe(0)
  })

  test('conta pendente: o código ativa com a senha escolhida e consome os convites', async () => {
    const pendente = await makeUser({ email: 'ana@exemplo.test', name: 'Ana Convidada', password: null })
    await prisma.userToken.create({ data: { userId: pendente.id, purpose: 'INVITE', tokenHash: generateToken().hash, expiresAt: new Date('2026-12-30T00:00:00Z') } })
    await pedir(slug)
    expect(mail.sent).toHaveLength(1)
    await confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: mail.codeOf() }, META, AGORA)
    const u = await prisma.user.findUniqueOrThrow({ where: { id: pendente.id } })
    expect(await verifyPassword(u.passwordHash ?? '', SENHA)).toBe(true)
    expect(u.emailVerifiedAt).toEqual(AGORA)
    expect(await prisma.userToken.count({ where: { userId: pendente.id, usedAt: null } })).toBe(0)
    expect(await prisma.user.count()).toBe(1)
    expect(await prisma.customer.count({ where: { userId: pendente.id } })).toBe(1)
  })
})

describe('código', () => {
  test('código errado conta tentativa; 5 erros matam o código', async () => {
    await pedir(slug)
    const certo = mail.codeOf()
    const errado = certo === '000000' ? '111111' : '000000'
    for (let n = 0; n < 5; n++) {
      const e = await erro(confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: errado }, META, AGORA))
      expect(e).toMatchObject({ code: 'validation', reason: 'invalid_code' })
    }
    expect((await erro(confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: certo }, META, AGORA))).reason).toBe('invalid_code')
    expect(await prisma.user.count()).toBe(0)
  })

  test('10 códigos errados por dia barram até o código certo', async () => {
    // Dois códigos, cinco palpites errados em cada: o teto diário (10) vale entre códigos sucessivos.
    for (let rodada = 0; rodada < 2; rodada++) {
      await pedir(slug, dados(), new Date(AGORA.getTime() + rodada * 16 * 60_000))
      const errado = mail.codeOf() === '000000' ? '111111' : '000000'
      for (let n = 0; n < 5; n++) await erro(confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: errado }, META, new Date(AGORA.getTime() + rodada * 16 * 60_000)))
    }
    const t = new Date(AGORA.getTime() + 17 * 60_000)
    await pedir(slug, dados(), t)
    // O terceiro código está certo e dentro do prazo, mas o teto diário de erros já foi atingido.
    const e = await erro(confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: mail.codeOf() }, META, t))
    expect(e.reason).toBe('invalid_code')
    expect(await prisma.user.count()).toBe(0)
    expect(await prisma.emailCode.count({ where: { consumedAt: null } })).toBe(1)
  })

  test('código vencido (15 minutos): invalid_code', async () => {
    await pedir(slug)
    const e = await erro(confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: mail.codeOf() }, META, new Date(AGORA.getTime() + 16 * 60_000)))
    expect(e.reason).toBe('invalid_code')
  })

  test('pedir de novo substitui: o código antigo deixa de valer', async () => {
    await pedir(slug)
    const antigo = mail.codeOf()
    await pedir(slug)
    const novo = mail.codeOf()
    expect(await prisma.emailCode.count({ where: { consumedAt: null } })).toBe(1)
    if (antigo !== novo) expect((await erro(confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: antigo }, META, AGORA))).reason).toBe('invalid_code')
    await confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: novo }, META, AGORA)
  })

  test('limite de pedidos por e-mail: o quarto pedido em 15 minutos não envia', async () => {
    for (let n = 0; n < 4; n++) await pedir(slug)
    expect(mail.sent).toHaveLength(3)
  })

  test('duas confirmações simultâneas do mesmo código: uma passa', async () => {
    await pedir(slug)
    const code = mail.codeOf()
    const rs = await Promise.allSettled([
      confirmStoreSignup(slug, { email: 'ana@exemplo.test', code }, META, AGORA),
      confirmStoreSignup(slug, { email: 'ana@exemplo.test', code }, META, AGORA),
    ])
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.user.count()).toBe(1)
    expect(await prisma.customer.count({ where: { businessId } })).toBe(1)
  })
})

test('dois cadastros do mesmo e-mail em lojas diferentes ao mesmo tempo: uma pessoa só', async () => {
  const outra = await makeBusiness({ slug: 'pet-outro' })
  await pedir(slug)
  const c1 = mail.codeOf()
  await pedir('pet-outro')
  const c2 = mail.codeOf()
  const rs = await Promise.allSettled([
    confirmStoreSignup(slug, { email: 'ana@exemplo.test', code: c1 }, META, AGORA),
    confirmStoreSignup('pet-outro', { email: 'ana@exemplo.test', code: c2 }, META, AGORA),
  ])
  expect(await prisma.user.count({ where: { email: 'ana@exemplo.test' } })).toBe(1)
  expect(rs.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
  for (const r of rs) {
    if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'conflict', reason: 'email_taken' })
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@exemplo.test' } })
  const ligados = await prisma.customer.findMany({ where: { userId: u.id } })
  expect(ligados.length).toBe(rs.filter((r) => r.status === 'fulfilled').length)
  expect(ligados.every((c) => [businessId, outra.id].includes(c.businessId))).toBe(true)
})

test('loja suspensa, inexistente ou slug reservado: not_found', async () => {
  await makeBusiness({ slug: 'pet-suspenso', status: 'SUSPENDED' })
  for (const s of ['pet-suspenso', 'nao-existe', 'painel', 'entrar']) {
    expect((await erro(requestStoreSignup(s, dados(), META, AGORA))).code, s).toBe('not_found')
    expect((await erro(confirmStoreSignup(s, { email: 'ana@exemplo.test', code: '123456' }, META, AGORA))).code, s).toBe('not_found')
    expect((await erro(signInAtStore(s, { email: 'ana@exemplo.test', password: SENHA }, META, AGORA))).code, s).toBe('not_found')
  }
})

describe('signInAtStore', () => {
  test('entra, vira cliente da loja e a sessão guarda a loja', async () => {
    const u = await makeUser({ password: SENHA })
    const r = await signInAtStore(slug, { email: u.email, password: SENHA }, META, AGORA)
    expect(r.join.kind).toBe('joined')
    expect(await getPersonSession(r.token, AGORA)).toMatchObject({ customerBusinessId: businessId })
    // Entrar de novo não cria outro cliente.
    expect((await signInAtStore(slug, { email: u.email, password: SENHA }, META, AGORA)).join.kind).toBe('already')
    expect(await prisma.customer.count({ where: { userId: u.id } })).toBe(1)
  })

  test('senha errada: invalid_credentials e nada é criado', async () => {
    const u = await makeUser({ password: SENHA })
    await expect(signInAtStore(slug, { email: u.email, password: 'errada-errada' }, META, AGORA)).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(await prisma.customer.count()).toBe(0)
  })
})
