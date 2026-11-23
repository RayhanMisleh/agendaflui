import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { POST as forgot } from '@/app/api/v1/auth/customer/password/forgot/route'
import { POST as reset } from '@/app/api/v1/auth/customer/password/reset/route'
import { POST as login } from '@/app/api/v1/auth/customer/login/route'
import { POST as logout } from '@/app/api/v1/auth/customer/logout/route'
import { POST as refresh } from '@/app/api/v1/auth/customer/refresh/route'
import { POST as register } from '@/app/api/v1/auth/customer/register/route'
import { POST as verify } from '@/app/api/v1/auth/customer/verify/route'
import type { RouteHandler } from '@/server/api/define-route'
import { verifyAccessToken } from '@/server/auth/api-tokens'
import { limitKey } from '@/server/auth/rate-limit-db'
import { purgeVerificationCodes } from '@/server/auth/verification-code'
import { setEmailChannel } from '@/server/notifications/channels'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { prisma } from '@/server/db/client'
import { confirmRegistration, requestRegistration } from '@/server/domain/customers/account'
import { addMinutes } from '@/server/time'
import { apiError, apiRequest, callRoute, flushAfter, jsonObject, pendingAfter } from '../../setup/api'
import { resetDb } from '../../setup/db'
import { makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService } from '../../setup/factories'
import { fakeMail } from '../../setup/mail'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

const mail = fakeMail()
const SENHA = 'senha-muito-segura-1'
const NOVA = 'outra-senha-segura-2'
const EMAIL = 'maria@exemplo.test'
const meta = { ip: null, userAgent: null }
const BASE = '/v1/auth/customer'

let contadorIp = 0
const outroIp = (): string => {
  contadorIp += 1
  return `198.51.${(contadorIp >> 8) & 255}.${contadorIp & 255}`
}

type Conta = { id: string; slug: string; nome: string }

async function novaConta(nome = 'Barbearia Ouro & Cia'): Promise<Conta> {
  const business = await makeBusiness()
  await prisma.businessBranding.update({ where: { businessId: business.id }, data: { displayName: nome, primaryColor: '#8A2BE2' } })
  return { id: business.id, slug: business.slug, nome }
}

/** Chama a rota e, a menos que `flush` seja falso, executa o trabalho que ela adiou para depois da resposta. */
async function chamar(handler: RouteHandler, caminho: string, conta: Conta, body: unknown, ip: string = outroIp(), flush = true) {
  const r = await callRoute(handler, apiRequest('POST', `${BASE}${caminho}`, { business: conta.slug, body, headers: { 'x-forwarded-for': ip } }))
  if (flush) await flushAfter()
  return r
}

const cadastrar = (c: Conta, email = EMAIL, extra: Record<string, unknown> = {}) =>
  chamar(register, '/register', c, { name: 'Maria Souza', email, phone: '(11) 91234-5678', password: SENHA, ...extra })

const confirmar = (c: Conta, code: string, email = EMAIL) => chamar(verify, '/verify', c, { email, code })

const entrar = (c: Conta, email: string, password: string, ip?: string) => chamar(login, '/login', c, { email, password }, ip)

function tokensDe(json: unknown): { accessToken: string; refreshToken: string } {
  const t = jsonObject(jsonObject(json).tokens)
  return { accessToken: String(t.accessToken), refreshToken: String(t.refreshToken) }
}

/** Código que não é o certo. */
const errado = (certo: string): string => (certo === '000000' ? '000001' : '000000')

async function clienteComSenha(c: Conta, o: { email?: string; password?: string; archivedAt?: Date } = {}) {
  return makeCustomer(c.id, {
    email: o.email ?? EMAIL,
    passwordHash: await hashPassword(o.password ?? SENHA),
    emailVerifiedAt: new Date(),
    origin: 'APP',
    ...(o.archivedAt ? { archivedAt: o.archivedAt } : {}),
  })
}

beforeEach(async () => {
  await resetDb()
  mail.install()
})
afterEach(() => {
  mail.uninstall()
  vi.restoreAllMocks()
})

describe('cadastro com confirmação', () => {
  test('o pedido não cria o cliente: guarda só o HMAC do código e entrega o e-mail com o código', async () => {
    const c = await novaConta()
    const r = await cadastrar(c, 'Maria@Exemplo.test')
    expect(r.status).toBe(202)
    expect(r.json).toEqual({ status: 'verification_sent' })
    expect(await prisma.customer.count()).toBe(0)

    expect(mail.sent).toHaveLength(1)
    const msg = mail.sent[0]
    expect(msg?.to).toBe(EMAIL)
    expect(msg?.subject).toContain('Barbearia Ouro & Cia')
    const code = mail.codeOf()
    expect(code).toMatch(/^\d{6}$/)

    const linhas = await prisma.verificationCode.findMany()
    expect(linhas).toHaveLength(1)
    const linha = linhas[0]
    expect(linha).toMatchObject({ businessId: c.id, purpose: 'REGISTER', email: EMAIL, attempts: 0, consumedAt: null })
    expect(linha?.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(linha?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000)
    expect(linha?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 5_000)
    // O código em texto não está em nenhuma coluna; a senha também não, só o hash dela no payload.
    const brutas = await prisma.$queryRaw<{ j: Record<string, unknown> }[]>`SELECT to_jsonb(v) AS j FROM verification_codes v`
    const valores = Object.values(brutas[0]?.j ?? {}).map((v) => JSON.stringify(v))
    expect(valores.some((v) => v === `"${code}"` || v === code)).toBe(false)
    const payload = JSON.stringify(linha?.payload)
    expect(payload).not.toContain(code)
    expect(payload).not.toContain(SENHA)
    const guardado = linha?.payload as { name: string; phone: string | null; passwordHash: string }
    expect(guardado).toMatchObject({ name: 'Maria Souza', phone: '5511912345678' })
    expect(guardado.passwordHash).toMatch(/^\$argon2/)
    expect(await verifyPassword(guardado.passwordHash, SENHA)).toBe(true)
  })

  test('confirmar com o código certo cria o cliente e devolve tokens válidos', async () => {
    const c = await novaConta()
    await cadastrar(c)
    const r = await confirmar(c, mail.codeOf())
    expect(r.status).toBe(200)
    const body = jsonObject(r.json)
    const { accessToken, refreshToken } = tokensDe(r.json)
    const cliente = await prisma.customer.findFirstOrThrow({ where: { businessId: c.id } })
    expect(body.customer).toEqual({ id: cliente.id, name: 'Maria Souza', email: EMAIL })
    expect(cliente).toMatchObject({ origin: 'APP', email: EMAIL, phone: '5511912345678', name: 'Maria Souza' })
    expect(cliente.emailVerifiedAt).not.toBeNull()
    expect(cliente.passwordHash).toMatch(/^\$argon2/)
    expect(await verifyAccessToken(accessToken, new Date())).toEqual({ kind: 'customer', businessId: c.id, customerId: cliente.id })
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await prisma.refreshToken.count({ where: { customerId: cliente.id, revokedAt: null } })).toBe(1)
    expect((await prisma.verificationCode.findFirstOrThrow()).consumedAt).not.toBeNull()
    // O código não vale duas vezes.
    const de_novo = await confirmar(c, mail.codeOf())
    expect(de_novo.status).toBe(422)
    // A senha cadastrada serve para entrar.
    expect((await entrar(c, EMAIL, SENHA)).status).toBe(200)
  })

  test('código errado 5 vezes mata o código, mesmo o certo depois', async () => {
    const c = await novaConta()
    await cadastrar(c)
    const code = mail.codeOf()
    for (let i = 0; i < 5; i++) {
      const r = await confirmar(c, errado(code))
      expect(r.status).toBe(422)
      expect(apiError(r.json)).toMatchObject({ code: 'validation', reason: 'invalid_code' })
    }
    const depois = await confirmar(c, code)
    expect(depois.status).toBe(422)
    expect(apiError(depois.json).reason).toBe('invalid_code')
    expect(await prisma.customer.count()).toBe(0)
    const linha = await prisma.verificationCode.findFirstOrThrow()
    expect(linha.attempts).toBe(5)
    expect(linha.consumedAt).not.toBeNull()
  })

  test('tentativas erradas em paralelo: o código morre na 5ª e a contagem não passa de 5', async () => {
    const c = await novaConta()
    await cadastrar(c)
    const code = mail.codeOf()
    const respostas = await Promise.all(Array.from({ length: 9 }, () => confirmar(c, errado(code))))
    expect(respostas.every((r) => r.status === 422)).toBe(true)
    const linha = await prisma.verificationCode.findFirstOrThrow()
    expect(linha.attempts).toBe(5)
    expect(linha.consumedAt).not.toBeNull()
    expect((await confirmar(c, code)).status).toBe(422)
  })

  test('duas confirmações simultâneas do mesmo código: exatamente uma passa', async () => {
    const c = await novaConta()
    await cadastrar(c)
    const code = mail.codeOf()
    const respostas = await Promise.all([confirmar(c, code), confirmar(c, code), confirmar(c, code)])
    expect(respostas.filter((r) => r.status === 200)).toHaveLength(1)
    expect(respostas.filter((r) => r.status === 422)).toHaveLength(2)
    expect(await prisma.customer.count()).toBe(1)
    expect(await prisma.refreshToken.count()).toBe(1)
  })

  test('código vencido falha; no limite de 15 minutos ainda vale 1 segundo antes', async () => {
    const c = await novaConta()
    const t0 = new Date()
    const i = { name: 'Maria Souza', email: EMAIL, password: SENHA }
    await (await requestRegistration(c.id, i, meta, t0))()
    const code = mail.codeOf()
    const tarde = await confirmRegistration(c.id, { email: EMAIL, code }, meta, addMinutes(t0, 15)).catch((e: unknown) => e)
    expect(tarde).toMatchObject({ code: 'validation', reason: 'invalid_code' })
    expect(await prisma.customer.count()).toBe(0)

    await (await requestRegistration(c.id, i, meta, t0))()
    const novo = mail.codeOf()
    const ok = await confirmRegistration(c.id, { email: EMAIL, code: novo }, meta, new Date(addMinutes(t0, 15).getTime() - 1000))
    expect(ok.customerId).toBeTruthy()
  })

  test('pedir de novo substitui: só o último código vale e há um vivo por e-mail', async () => {
    const c = await novaConta()
    await cadastrar(c)
    const primeiro = mail.codeOf()
    await cadastrar(c)
    const segundo = mail.codeOf()
    expect(await prisma.verificationCode.count({ where: { consumedAt: null } })).toBe(1)
    expect(await prisma.verificationCode.count()).toBe(2)
    if (primeiro !== segundo) expect((await confirmar(c, primeiro)).status).toBe(422)
    expect((await confirmar(c, segundo)).status).toBe(200)
  })

  test('pedidos simultâneos não geram erro 500 e deixam um único código vivo', async () => {
    const c = await novaConta()
    const respostas = await Promise.all(
      [1, 2, 3].map(() => chamar(register, '/register', c, { name: 'Maria Souza', email: EMAIL, password: SENHA }, outroIp(), false)),
    )
    expect(respostas.map((r) => r.status)).toEqual([202, 202, 202])
    await flushAfter()
    expect(await prisma.verificationCode.count({ where: { consumedAt: null } })).toBe(1)
  })

  test('limite por e-mail: do 4º pedido em diante a resposta é a mesma e nada é enviado', async () => {
    const c = await novaConta()
    const respostas = []
    for (let i = 0; i < 5; i++) respostas.push(await cadastrar(c))
    expect(respostas.map((r) => r.status)).toEqual([202, 202, 202, 202, 202])
    expect(new Set(respostas.map((r) => r.text)).size).toBe(1)
    expect(mail.sent).toHaveLength(3)
    // O limite é do e-mail: outro e-mail ainda recebe.
    await cadastrar(c, 'joana@exemplo.test')
    expect(mail.sent).toHaveLength(4)
  })

  test('e-mail de cliente que já tem senha: 202 idêntico, e-mail diz que a conta existe e nenhum código é criado', async () => {
    const c = await novaConta()
    const existente = await clienteComSenha(c, { email: 'ana@exemplo.test' })
    const nova = await cadastrar(c, 'bia@exemplo.test')
    const mesma = await cadastrar(c, 'ana@exemplo.test')
    expect(mesma.status).toBe(nova.status)
    expect(mesma.text).toBe(nova.text)
    expect(await prisma.verificationCode.count({ where: { email: 'ana@exemplo.test' } })).toBe(0)
    expect(await prisma.customer.findFirstOrThrow({ where: { id: existente.id } })).toMatchObject({ email: 'ana@exemplo.test' })
    expect(mail.sent).toHaveLength(2)
    const aviso = mail.sent[1]
    expect(aviso?.to).toBe('ana@exemplo.test')
    expect(aviso?.text).not.toMatch(/\b\d{6}\b/)
    expect(aviso?.text.toLowerCase()).toContain('senha')
    expect(aviso?.subject).not.toBe(mail.sent[0]?.subject)
  })

  test('cadastro de balcão: confirmar assume o mesmo registro, mantém nome e histórico e grava a senha', async () => {
    const c = await novaConta()
    const balcao = await makeCustomer(c.id, { name: 'Maria do Balcão', email: EMAIL, notes: 'Prefere horário cedo' })
    const profissional = await makeProfessional(c.id)
    const servico = await makeService(c.id)
    const agendamento = await makeAppointment(c.id, {
      customerId: balcao.id,
      professionalId: profissional.id,
      serviceId: servico.id,
      startsAt: addMinutes(new Date(), 60 * 48),
    })
    await cadastrar(c)
    expect(await prisma.customer.count()).toBe(1)
    const r = await confirmar(c, mail.codeOf())
    expect(r.status).toBe(200)
    expect(await prisma.customer.count()).toBe(1)
    const depois = await prisma.customer.findFirstOrThrow()
    expect(depois).toMatchObject({ id: balcao.id, name: 'Maria do Balcão', notes: 'Prefere horário cedo', origin: 'PANEL', phone: balcao.phone })
    expect(depois.emailVerifiedAt).not.toBeNull()
    expect(await verifyPassword(depois.passwordHash ?? '', SENHA)).toBe(true)
    expect(await prisma.appointment.count({ where: { id: agendamento.id, customerId: balcao.id } })).toBe(1)
    expect(jsonObject(jsonObject(r.json).customer)).toMatchObject({ id: balcao.id, name: 'Maria do Balcão' })
  })

  test('o código é preso à conta, ao propósito e ao e-mail', async () => {
    const a = await novaConta('Conta A')
    const b = await novaConta('Conta B')
    await cadastrar(a)
    const code = mail.codeOf()
    // Outra conta, mesmo e-mail e mesmo código.
    expect((await confirmar(b, code)).status).toBe(422)
    // Outro e-mail na mesma conta.
    expect((await confirmar(a, code, 'joana@exemplo.test')).status).toBe(422)
    // Linha adulterada para outro e-mail: o HMAC não bate.
    await prisma.verificationCode.updateMany({ data: { email: 'joana@exemplo.test' } })
    expect((await confirmar(a, code, 'joana@exemplo.test')).status).toBe(422)
    expect(await prisma.customer.count()).toBe(0)
  })

  test('o mesmo e-mail em outra conta é independente', async () => {
    const a = await novaConta('Conta A')
    const b = await novaConta('Conta B')
    await cadastrar(a)
    await cadastrar(b)
    expect(await prisma.verificationCode.count({ where: { consumedAt: null } })).toBe(2)
    expect((await confirmar(a, mail.codeOf(0))).status).toBe(200)
    expect((await confirmar(b, mail.codeOf(1))).status).toBe(200)
    expect(await prisma.customer.count({ where: { businessId: a.id } })).toBe(1)
    expect(await prisma.customer.count({ where: { businessId: b.id } })).toBe(1)
    expect(await prisma.customer.count()).toBe(2)
  })

  test('canal de e-mail com falha ou ausente não muda a resposta e o log não traz código nem e-mail inteiro', async () => {
    const c = await novaConta()
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mail.failing = true
    const r = await cadastrar(c)
    expect(r.status).toBe(202)
    expect(r.json).toEqual({ status: 'verification_sent' })
    expect(await prisma.verificationCode.count()).toBe(1)
    const falhou = mail.failed[0]
    expect(falhou).toBeDefined()
    const saida = [...erro.mock.calls, ...aviso.mock.calls, ...log.mock.calls].flat().map(String).join('\n')
    expect(saida).not.toBe('')
    expect(saida).not.toContain(EMAIL)
    expect(saida).not.toContain(mail.codeOfFailed())
    expect(saida).toContain('m***@exemplo.test')

    setEmailChannel(null)
    expect((await cadastrar(c, 'joana@exemplo.test')).status).toBe(202)
  })

  test('validação: e-mail inválido, senha curta, campo desconhecido e e-mail com vírgula', async () => {
    const c = await novaConta()
    const email = await cadastrar(c, 'sem-arroba')
    expect(email.status).toBe(422)
    expect(apiError(email.json).fields).toHaveProperty('email')
    const curta = await cadastrar(c, EMAIL, { password: 'curta' })
    expect(curta.status).toBe(422)
    expect(apiError(curta.json).fields).toHaveProperty('password')
    expect((await cadastrar(c, EMAIL, { extra: 1 })).status).toBe(422)
    expect((await cadastrar(c, 'a@b.test,vitima@x.test')).status).toBe(422)
    expect((await cadastrar(c, EMAIL, { phone: 'abc' })).status).toBe(422)
    expect(mail.sent).toHaveLength(0)
  })
})

describe('entrada', () => {
  test('e-mail em maiúsculas entra e devolve tokens e o resumo do cliente', async () => {
    const c = await novaConta()
    const cliente = await clienteComSenha(c)
    const r = await entrar(c, '  MARIA@Exemplo.TEST ', SENHA)
    expect(r.status).toBe(200)
    expect(jsonObject(r.json).customer).toEqual({ id: cliente.id, name: cliente.name, email: EMAIL })
    const { accessToken } = tokensDe(r.json)
    expect(await verifyAccessToken(accessToken, new Date())).toEqual({ kind: 'customer', businessId: c.id, customerId: cliente.id })
  })

  test('senha errada, e-mail inexistente, cliente sem senha, arquivado e anonimizado dão a mesma resposta', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    await makeCustomer(c.id, { email: 'balcao@exemplo.test' })
    await clienteComSenha(c, { email: 'arquivado@exemplo.test', archivedAt: new Date() })
    const anon = await clienteComSenha(c, { email: 'anon@exemplo.test' })
    await prisma.customer.update({ where: { id: anon.id }, data: { email: null, passwordHash: null, anonymizedAt: new Date() } })
    const casos = [
      await entrar(c, EMAIL, 'senha-errada-qualquer'),
      await entrar(c, 'ninguem@exemplo.test', SENHA),
      await entrar(c, 'balcao@exemplo.test', SENHA),
      await entrar(c, 'arquivado@exemplo.test', SENHA),
      await entrar(c, 'anon@exemplo.test', SENHA),
      await entrar(c, 'isto-nem-e-email', SENHA),
    ]
    for (const r of casos) {
      expect(r.status).toBe(401)
      expect(apiError(r.json)).toMatchObject({ code: 'unauthorized', reason: 'invalid_credentials' })
    }
    expect(new Set(casos.map((r) => r.text)).size).toBe(1)
  })

  test('a 6ª tentativa seguida do mesmo e-mail e IP é barrada com 429', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    const ip = '203.0.113.50'
    for (let i = 0; i < 5; i++) expect((await entrar(c, EMAIL, 'errada-errada-1', ip)).status).toBe(401)
    const sexta = await entrar(c, EMAIL, SENHA, ip)
    expect(sexta.status).toBe(429)
    expect(apiError(sexta.json).code).toBe('rate_limited')
    expect(Number(sexta.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  test('entrar com sucesso limpa a contagem do e-mail e IP', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    const ip = '203.0.113.51'
    for (let i = 0; i < 4; i++) await entrar(c, EMAIL, 'errada-errada-1', ip)
    expect((await entrar(c, EMAIL, SENHA, ip)).status).toBe(200)
    for (let i = 0; i < 4; i++) expect((await entrar(c, EMAIL, 'errada-errada-1', ip)).status).toBe(401)
  })

  test('a contagem de uma conta não afeta a outra', async () => {
    const a = await novaConta('A')
    const b = await novaConta('B')
    await clienteComSenha(a)
    await clienteComSenha(b)
    const ip = '203.0.113.52'
    for (let i = 0; i < 5; i++) await entrar(a, EMAIL, 'errada-errada-1', ip)
    expect((await entrar(a, EMAIL, SENHA, ip)).status).toBe(429)
    expect((await entrar(b, EMAIL, SENHA, ip)).status).toBe(200)
  })
})

describe('renovação e saída', () => {
  test('a renovação rotaciona e o reuso do token antigo derruba a família', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    const primeiro = tokensDe((await entrar(c, EMAIL, SENHA)).json)
    const r1 = await chamar(refresh, '/refresh', c, { refreshToken: primeiro.refreshToken })
    expect(r1.status).toBe(200)
    const segundo = tokensDe(r1.json)
    expect(segundo.refreshToken).not.toBe(primeiro.refreshToken)
    expect(Object.keys(jsonObject(r1.json))).toEqual(['tokens'])
    // Reuso do antigo: 401 e a família inteira cai, inclusive o token novo.
    const reuso = await chamar(refresh, '/refresh', c, { refreshToken: primeiro.refreshToken })
    expect(reuso.status).toBe(401)
    expect((await chamar(refresh, '/refresh', c, { refreshToken: segundo.refreshToken })).status).toBe(401)
  })

  test('15 renovações e saídas seguidas do mesmo IP (rede compartilhada), com tokens distintos, passam', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    const ip = '203.0.113.88'
    const pares = []
    for (let i = 0; i < 15; i++) pares.push(tokensDe((await entrar(c, EMAIL, SENHA)).json))
    for (const p of pares) expect((await chamar(refresh, '/refresh', c, { refreshToken: p.refreshToken }, ip)).status).toBe(200)
    for (const p of pares) expect((await chamar(logout, '/logout', c, { refreshToken: p.refreshToken }, ip)).status).toBe(204)
  })

  test('token de renovação desconhecido ou malformado: 401', async () => {
    const c = await novaConta()
    expect((await chamar(refresh, '/refresh', c, { refreshToken: 'x'.repeat(43) })).status).toBe(401)
    expect((await chamar(refresh, '/refresh', c, { refreshToken: 'curto' })).status).toBe(401)
  })

  test('sair revoga a família; sair com token desconhecido também responde 204', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    const { refreshToken } = tokensDe((await entrar(c, EMAIL, SENHA)).json)
    const r = await chamar(logout, '/logout', c, { refreshToken })
    expect(r.status).toBe(204)
    expect(r.text).toBe('')
    expect((await chamar(refresh, '/refresh', c, { refreshToken })).status).toBe(401)
    expect((await chamar(logout, '/logout', c, { refreshToken: 'y'.repeat(43) })).status).toBe(204)
  })
})

describe('esqueci a senha e redefinição', () => {
  test('e-mail inexistente: 202 igual ao de e-mail existente, e nenhum e-mail enviado', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    const inexistente = await chamar(forgot, '/password/forgot', c, { email: 'ninguem@exemplo.test' })
    expect(inexistente.status).toBe(202)
    expect(mail.sent).toHaveLength(0)
    expect(await prisma.verificationCode.count()).toBe(0)
    const existente = await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    expect(existente.status).toBe(202)
    expect(existente.text).toBe(inexistente.text)
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]?.to).toBe(EMAIL)
    expect(await prisma.verificationCode.count({ where: { purpose: 'PASSWORD_RESET' } })).toBe(1)
  })

  test('e-mail malformado também responde 202 e não envia nada', async () => {
    const c = await novaConta()
    expect((await chamar(forgot, '/password/forgot', c, { email: 'nao-e-email' })).status).toBe(202)
    expect(mail.sent).toHaveLength(0)
  })

  test('cliente arquivado não recebe código; cadastro de balcão recebe', async () => {
    const c = await novaConta()
    await clienteComSenha(c, { email: 'arq@exemplo.test', archivedAt: new Date() })
    await makeCustomer(c.id, { email: 'balcao@exemplo.test' })
    await chamar(forgot, '/password/forgot', c, { email: 'arq@exemplo.test' })
    expect(mail.sent).toHaveLength(0)
    await chamar(forgot, '/password/forgot', c, { email: 'balcao@exemplo.test' })
    expect(mail.sent).toHaveLength(1)
  })

  test('redefinir com o código troca a senha e invalida os tokens de renovação antigos', async () => {
    const c = await novaConta()
    const cliente = await clienteComSenha(c)
    const antigo = tokensDe((await entrar(c, EMAIL, SENHA)).json)
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const code = mail.codeOf()
    const r = await chamar(reset, '/password/reset', c, { email: EMAIL, code, password: NOVA })
    expect(r.status).toBe(204)
    expect(await prisma.refreshToken.count({ where: { customerId: cliente.id, revokedAt: null } })).toBe(0)
    expect((await chamar(refresh, '/refresh', c, { refreshToken: antigo.refreshToken })).status).toBe(401)
    expect((await entrar(c, EMAIL, SENHA)).status).toBe(401)
    expect((await entrar(c, EMAIL, NOVA)).status).toBe(200)
    // O código não vale duas vezes.
    expect((await chamar(reset, '/password/reset', c, { email: EMAIL, code, password: SENHA })).status).toBe(422)
  })

  test('redefinir com código errado 5 vezes mata o código; senha curta é recusada sem gastar o código', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const code = mail.codeOf()
    const curta = await chamar(reset, '/password/reset', c, { email: EMAIL, code, password: 'curta' })
    expect(curta.status).toBe(422)
    expect(apiError(curta.json).fields).toHaveProperty('password')
    expect((await prisma.verificationCode.findFirstOrThrow()).attempts).toBe(0)
    for (let i = 0; i < 5; i++) {
      const r = await chamar(reset, '/password/reset', c, { email: EMAIL, code: errado(code), password: NOVA })
      expect(apiError(r.json).reason).toBe('invalid_code')
    }
    expect((await chamar(reset, '/password/reset', c, { email: EMAIL, code, password: NOVA })).status).toBe(422)
    expect((await entrar(c, EMAIL, SENHA)).status).toBe(200)
  })

  test('cadastro de balcão sem senha redefine e passa a entrar; o código de cadastro não serve para redefinir', async () => {
    const c = await novaConta()
    await makeCustomer(c.id, { email: EMAIL })
    await cadastrar(c)
    const codigoDeCadastro = mail.codeOf()
    expect((await chamar(reset, '/password/reset', c, { email: EMAIL, code: codigoDeCadastro, password: NOVA })).status).toBe(422)
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const r = await chamar(reset, '/password/reset', c, { email: EMAIL, code: mail.codeOf(), password: NOVA })
    expect(r.status).toBe(204)
    expect((await entrar(c, EMAIL, NOVA)).status).toBe(200)
  })

  test('limite por e-mail no esqueci a senha: do 4º pedido em diante nada é enviado, com a mesma resposta', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    const respostas = []
    for (let i = 0; i < 5; i++) respostas.push(await chamar(forgot, '/password/forgot', c, { email: EMAIL }))
    expect(new Set(respostas.map((r) => r.text)).size).toBe(1)
    expect(respostas.every((r) => r.status === 202)).toBe(true)
    expect(mail.sent).toHaveLength(3)
  })

  test('limite de rota: o 31º pedido do mesmo IP é barrado com 429', async () => {
    const c = await novaConta()
    const ip = '203.0.113.77'
    const status: number[] = []
    for (let i = 0; i < 31; i++) status.push((await chamar(forgot, '/password/forgot', c, { email: `p${i}@exemplo.test` }, ip)).status)
    expect(status.slice(0, 30).every((s) => s === 202)).toBe(true)
    expect(status[30]).toBe(429)
  })
})

describe('nada que dependa do e-mail acontece antes da resposta', () => {
  test('antes do flushAfter nenhum caminho toca a tabela de códigos nem o canal; depois, só os que devem', async () => {
    const c = await novaConta()
    await clienteComSenha(c, { email: 'existe@exemplo.test' })
    await makeCustomer(c.id, { email: 'balcao@exemplo.test' })
    await clienteComSenha(c, { email: 'arquivado@exemplo.test', archivedAt: new Date() })
    const respostas = []
    for (const email of ['novo@exemplo.test', 'existe@exemplo.test', 'balcao@exemplo.test', 'arquivado@exemplo.test']) {
      respostas.push(await chamar(register, '/register', c, { name: 'Maria', email, password: SENHA }, outroIp(), false))
    }
    for (const email of ['existe@exemplo.test', 'balcao@exemplo.test', 'inexistente@exemplo.test', 'arquivado@exemplo.test']) {
      respostas.push(await chamar(forgot, '/password/forgot', c, { email }, outroIp(), false))
    }
    expect(respostas.every((r) => r.status === 202)).toBe(true)
    expect(new Set(respostas.map((r) => r.text)).size).toBe(1)
    expect(pendingAfter()).toBe(8)
    expect(await prisma.verificationCode.count()).toBe(0)
    expect(await prisma.rateLimitBucket.count({ where: { key: { startsWith: 'codigo' } } })).toBe(0)
    expect(mail.sent).toHaveLength(0)
    await flushAfter()
    // novo, existente (aviso), balcão no cadastro; existente e balcão no esqueci.
    expect(mail.sent).toHaveLength(5)
    expect(await prisma.verificationCode.count()).toBe(4)
  })

  test('cadastro com e-mail de cliente arquivado: 202, nenhum código e nenhum e-mail', async () => {
    const c = await novaConta()
    await clienteComSenha(c, { email: 'arquivado@exemplo.test', archivedAt: new Date() })
    expect((await cadastrar(c, 'arquivado@exemplo.test')).status).toBe(202)
    expect(await prisma.verificationCode.count()).toBe(0)
    expect(mail.sent).toHaveLength(0)
  })
})

describe('tentativas de código atravessando códigos', () => {
  test('10 erros espalhados por três códigos: o 11º palpite, mesmo certo, dá invalid_code sem consumir o código', async () => {
    const c = await novaConta()
    await cadastrar(c)
    let code = mail.codeOf()
    for (let i = 0; i < 4; i++) expect((await confirmar(c, errado(code))).status).toBe(422)
    await cadastrar(c)
    code = mail.codeOf()
    for (let i = 0; i < 4; i++) expect((await confirmar(c, errado(code))).status).toBe(422)
    await cadastrar(c)
    code = mail.codeOf()
    for (let i = 0; i < 2; i++) expect((await confirmar(c, errado(code))).status).toBe(422)
    const certo = await confirmar(c, code)
    expect(certo.status).toBe(422)
    expect(apiError(certo.json).reason).toBe('invalid_code')
    const linha = await prisma.verificationCode.findFirstOrThrow({ where: { consumedAt: null } })
    expect(linha.attempts).toBe(2)
    expect(await prisma.customer.count()).toBe(0)
  })

  test('o contador é comum aos dois propósitos e o sucesso não o zera', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const reset1 = mail.codeOf()
    for (let i = 0; i < 5; i++) await chamar(reset, '/password/reset', c, { email: EMAIL, code: errado(reset1), password: NOVA })
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const reset2 = mail.codeOf()
    for (let i = 0; i < 5; i++) await chamar(reset, '/password/reset', c, { email: EMAIL, code: errado(reset2), password: NOVA })
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const reset3 = mail.codeOf()
    const r = await chamar(reset, '/password/reset', c, { email: EMAIL, code: reset3, password: NOVA })
    expect(r.status).toBe(422)
    expect((await entrar(c, EMAIL, SENHA)).status).toBe(200)
  })

  test('redefinir bloqueado pelo teto de palpites faz o mesmo trabalho de senha que o caminho normal', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const reset1 = mail.codeOf()
    for (let i = 0; i < 5; i++) await chamar(reset, '/password/reset', c, { email: EMAIL, code: errado(reset1), password: NOVA })
    await chamar(forgot, '/password/forgot', c, { email: EMAIL })
    const reset2 = mail.codeOf()
    for (let i = 0; i < 5; i++) await chamar(reset, '/password/reset', c, { email: EMAIL, code: errado(reset2), password: NOVA })
    const hash = vi.spyOn(await import('@/server/auth/password'), 'hashPassword')
    const bloqueado = await chamar(reset, '/password/reset', c, { email: EMAIL, code: errado(reset2), password: NOVA })
    expect(bloqueado.status).toBe(422)
    expect(hash).toHaveBeenCalledTimes(1)
    hash.mockRestore()
  })

  test('teto diário de emissão: o 7º pedido do dia não emite, com a mesma resposta', async () => {
    const c = await novaConta()
    await clienteComSenha(c)
    // Zera só a janela curta a cada pedido para isolar o teto diário.
    const respostas = []
    for (let i = 0; i < 7; i++) {
      await prisma.rateLimitBucket.deleteMany({ where: { key: limitKey(`codigo:${c.id}:PASSWORD_RESET`, EMAIL) } })
      respostas.push(await chamar(forgot, '/password/forgot', c, { email: EMAIL }))
    }
    expect(respostas.every((r) => r.status === 202)).toBe(true)
    expect(new Set(respostas.map((r) => r.text)).size).toBe(1)
    expect(mail.sent).toHaveLength(6)
  })
})

describe('payload e limpeza', () => {
  const payloadsVivos = async () =>
    (await prisma.verificationCode.findMany()).map((l) => ({ consumed: l.consumedAt !== null, payload: JSON.stringify(l.payload) }))

  test('confirmar, substituir e matar por tentativas deixam o payload vazio', async () => {
    const c = await novaConta()
    await cadastrar(c)
    await cadastrar(c)
    let linhas = await payloadsVivos()
    expect(linhas.filter((l) => l.consumed).every((l) => l.payload === '{}')).toBe(true)
    expect(linhas.filter((l) => !l.consumed).every((l) => l.payload.includes('passwordHash'))).toBe(true)
    const code = mail.codeOf()
    expect((await confirmar(c, code)).status).toBe(200)
    linhas = await payloadsVivos()
    expect(linhas.every((l) => l.consumed && l.payload === '{}')).toBe(true)

    await resetDb()
    const d = await novaConta()
    await cadastrar(d)
    const certo = mail.codeOf()
    for (let i = 0; i < 5; i++) await confirmar(d, errado(certo))
    linhas = await payloadsVivos()
    expect(linhas.every((l) => l.consumed && l.payload === '{}')).toBe(true)
  })

  test('vencido também é limpo', async () => {
    const c = await novaConta()
    const t0 = new Date()
    await (await requestRegistration(c.id, { name: 'Maria', email: EMAIL, password: SENHA }, meta, t0))()
    await confirmRegistration(c.id, { email: EMAIL, code: mail.codeOf() }, meta, addMinutes(t0, 16)).catch(() => undefined)
    expect((await payloadsVivos()).every((l) => l.consumed && l.payload === '{}')).toBe(true)
  })

  test('purgeVerificationCodes apaga só o que venceu há mais de 1 dia', async () => {
    const c = await novaConta()
    const agora = new Date()
    const base = { businessId: c.id, purpose: 'REGISTER' as const, codeHash: 'h'.repeat(64) }
    await prisma.verificationCode.create({ data: { ...base, email: 'a@x.test', expiresAt: addMinutes(agora, -(24 * 60 + 1)) } })
    await prisma.verificationCode.create({ data: { ...base, email: 'b@x.test', expiresAt: addMinutes(agora, -(23 * 60)) } })
    await prisma.verificationCode.create({ data: { ...base, email: 'c@x.test', expiresAt: addMinutes(agora, 10) } })
    expect(await purgeVerificationCodes(agora)).toBe(1)
    expect((await prisma.verificationCode.findMany()).map((l) => l.email).sort()).toEqual(['b@x.test', 'c@x.test'])
  })
})
