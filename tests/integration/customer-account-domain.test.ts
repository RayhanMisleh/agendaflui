import { createHmac, hkdfSync } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { issueTokens } from '@/server/auth/api-tokens'
import { createCustomerContext } from '@/server/auth/customer-context'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { codeMac } from '@/server/auth/verification-code'
import { tenantDb } from '@/server/db/tenant'
import { prisma } from '@/server/db/client'
import { archiveCustomer, anonymizeCustomer } from '@/server/domain/customers/customers'
import { changePassword, deleteOwnAccount } from '@/server/domain/customers/account'
import { addMinutes } from '@/server/time'
import { domainError } from '../setup/expect'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCtx, makeCustomer, makeProfessional, makeService } from '../setup/factories'

const SENHA = 'senha-muito-segura-1'
const NOVA = 'outra-senha-segura-2'
const meta = { ip: null, userAgent: null }

beforeEach(resetDb)

async function clienteApp(businessId: string, email = 'maria@exemplo.test') {
  const c = await makeCustomer(businessId, {
    email,
    name: 'Maria Souza',
    passwordHash: await hashPassword(SENHA),
    emailVerifiedAt: new Date(),
    origin: 'APP',
  })
  const ctx = await makeCtx({ id: businessId }, { actor: { kind: 'customer', customerId: c.id, name: c.name }, channel: 'app' })
  return { c, ctx }
}

async function comSessaoDispositivoECodigo(businessId: string, customerId: string, email: string) {
  const pair = await tenantDb(businessId).$transaction((tx) =>
    issueTokens(tx, { kind: 'customer', businessId, customerId }, meta, new Date()),
  )
  await prisma.device.create({ data: { businessId, customerId, platform: 'IOS', pushToken: `tok-${customerId}`, lastSeenAt: new Date() } })
  await prisma.verificationCode.create({
    data: { businessId, purpose: 'PASSWORD_RESET', email, codeHash: 'a'.repeat(64), expiresAt: addMinutes(new Date(), 15) },
  })
  return pair
}

describe('codeMac', () => {
  test('HMAC-SHA256 com chave HKDF de rótulo próprio sobre conta, propósito, e-mail e código', () => {
    const chave = Buffer.from(hkdfSync('sha256', process.env.APP_SECRET ?? '', '', 'agendaflui/verification-code/v1', 32))
    const esperado = createHmac('sha256', chave)
      .update(JSON.stringify(['b1', 'REGISTER', 'a@b.test', '123456']))
      .digest('hex')
    expect(codeMac('b1', 'REGISTER', 'a@b.test', '123456')).toBe(esperado)
    // Cada parte da mensagem muda o resultado.
    const base = codeMac('b1', 'REGISTER', 'a@b.test', '123456')
    expect(codeMac('b2', 'REGISTER', 'a@b.test', '123456')).not.toBe(base)
    expect(codeMac('b1', 'PASSWORD_RESET', 'a@b.test', '123456')).not.toBe(base)
    expect(codeMac('b1', 'REGISTER', 'c@b.test', '123456')).not.toBe(base)
    expect(codeMac('b1', 'REGISTER', 'a@b.test', '123457')).not.toBe(base)
  })

  test('a chave não é a do token de acesso (rótulo diferente)', () => {
    const chaveDoToken = Buffer.from(hkdfSync('sha256', process.env.APP_SECRET ?? '', '', 'agendaflui/api-access/v1', 32))
    const comChaveDoToken = createHmac('sha256', chaveDoToken)
      .update(JSON.stringify(['b1', 'REGISTER', 'a@b.test', '123456']))
      .digest('hex')
    expect(codeMac('b1', 'REGISTER', 'a@b.test', '123456')).not.toBe(comChaveDoToken)
  })
})

describe('índice de código vivo', () => {
  test('um código vivo por conta, propósito e e-mail; consumido ou de outro propósito/conta não conflita', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const dados = (businessId: string, purpose: 'REGISTER' | 'PASSWORD_RESET', email: string, consumedAt: Date | null = null) => ({
      businessId,
      purpose,
      email,
      codeHash: 'h'.repeat(64),
      expiresAt: addMinutes(new Date(), 15),
      consumedAt,
    })
    await prisma.verificationCode.create({ data: dados(a.id, 'REGISTER', 'x@y.test') })
    await expect(prisma.verificationCode.create({ data: dados(a.id, 'REGISTER', 'x@y.test') })).rejects.toMatchObject({ code: 'P2002' })
    await prisma.verificationCode.create({ data: dados(a.id, 'REGISTER', 'x@y.test', new Date()) })
    await prisma.verificationCode.create({ data: dados(a.id, 'REGISTER', 'x@y.test', new Date()) })
    await prisma.verificationCode.create({ data: dados(a.id, 'PASSWORD_RESET', 'x@y.test') })
    await prisma.verificationCode.create({ data: dados(b.id, 'REGISTER', 'x@y.test') })
    await prisma.verificationCode.create({ data: dados(a.id, 'REGISTER', 'z@y.test') })
    // Consumir o vivo libera o lugar.
    await prisma.verificationCode.updateMany({ where: { businessId: a.id, purpose: 'REGISTER', email: 'x@y.test' }, data: { consumedAt: new Date() } })
    await prisma.verificationCode.create({ data: dados(a.id, 'REGISTER', 'x@y.test') })
  })
})

describe('changePassword', () => {
  test('troca a senha e revoga todos os tokens de renovação', async () => {
    const b = await makeBusiness()
    const { c, ctx } = await clienteApp(b.id)
    await comSessaoDispositivoECodigo(b.id, c.id, 'maria@exemplo.test')
    await changePassword(ctx, { current: SENHA, next: NOVA })
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(await verifyPassword(depois.passwordHash ?? '', NOVA)).toBe(true)
    expect(await verifyPassword(depois.passwordHash ?? '', SENHA)).toBe(false)
    expect(await prisma.refreshToken.count({ where: { customerId: c.id, revokedAt: null } })).toBe(0)
    expect(await prisma.refreshToken.count({ where: { customerId: c.id } })).toBe(1)
  })

  test('senha atual errada: nada muda; senha nova curta é recusada', async () => {
    const b = await makeBusiness()
    const { c, ctx } = await clienteApp(b.id)
    await comSessaoDispositivoECodigo(b.id, c.id, 'maria@exemplo.test')
    const antes = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    const e = await domainError(changePassword(ctx, { current: 'senha-errada-qualquer', next: NOVA }))
    expect(e).toMatchObject({ code: 'forbidden', reason: 'wrong_password' })
    const curta = await domainError(changePassword(ctx, { current: SENHA, next: 'curta' }))
    expect(curta.code).toBe('validation')
    expect(curta.fields).toHaveProperty('next')
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(depois.passwordHash).toBe(antes.passwordHash)
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1)
  })

  test('só o cliente troca a própria senha; erros repetidos de senha atual são limitados', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER')
    expect((await domainError(changePassword(dono, { current: SENHA, next: NOVA }))).code).toBe('forbidden')
    const { ctx } = await clienteApp(b.id)
    for (let i = 0; i < 5; i++) await domainError(changePassword(ctx, { current: 'errada-errada-1', next: NOVA }))
    await expect(changePassword(ctx, { current: SENHA, next: NOVA })).rejects.toMatchObject({ code: 'rate_limited' })
  })
})

describe('deleteOwnAccount', () => {
  test('senha errada: nada muda', async () => {
    const b = await makeBusiness()
    const { c, ctx } = await clienteApp(b.id)
    const pair = await comSessaoDispositivoECodigo(b.id, c.id, 'maria@exemplo.test')
    const e = await domainError(deleteOwnAccount(ctx, { password: 'senha-errada-qualquer' }))
    expect(e).toMatchObject({ code: 'forbidden', reason: 'wrong_password' })
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(depois).toMatchObject({ anonymizedAt: null, email: 'maria@exemplo.test', name: 'Maria Souza' })
    expect(await prisma.refreshToken.count()).toBe(1)
    expect(await prisma.device.count()).toBe(1)
    expect(await prisma.verificationCode.count()).toBe(1)
    expect(pair.refreshToken).toBeTruthy()
  })

  test('senha certa anonimiza, cancela os agendamentos futuros, apaga tokens, dispositivos e códigos', async () => {
    const b = await makeBusiness()
    const { c, ctx } = await clienteApp(b.id)
    await comSessaoDispositivoECodigo(b.id, c.id, 'maria@exemplo.test')
    const outra = await clienteApp(b.id, 'outra@exemplo.test')
    await comSessaoDispositivoECodigo(b.id, outra.c.id, 'outra@exemplo.test')
    const profissional = await makeProfessional(b.id)
    const servico = await makeService(b.id)
    const futuro = await makeAppointment(b.id, {
      customerId: c.id,
      professionalId: profissional.id,
      serviceId: servico.id,
      startsAt: addMinutes(new Date(), 60 * 48),
    })
    await deleteOwnAccount(ctx, { password: SENHA })
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(depois).toMatchObject({ name: 'Cliente removido', email: null, passwordHash: null })
    expect(depois.anonymizedAt).not.toBeNull()
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: futuro.id } })).status).toBe('CANCELED')
    expect(await prisma.refreshToken.count({ where: { customerId: c.id } })).toBe(0)
    expect(await prisma.device.count({ where: { customerId: c.id } })).toBe(0)
    expect(await prisma.verificationCode.count({ where: { email: 'maria@exemplo.test' } })).toBe(0)
    // O outro cliente não é tocado.
    expect(await prisma.refreshToken.count({ where: { customerId: outra.c.id } })).toBe(1)
    expect(await prisma.device.count({ where: { customerId: outra.c.id } })).toBe(1)
    expect(await prisma.verificationCode.count({ where: { email: 'outra@exemplo.test' } })).toBe(1)
    // O token de acesso deixa de valer na requisição seguinte.
    await expect(createCustomerContext({ businessId: b.id, customerId: c.id, request: meta })).rejects.toMatchObject({ reason: 'session_invalid' })
  })

  test('só o próprio cliente apaga a conta', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER')
    expect((await domainError(deleteOwnAccount(dono, { password: SENHA }))).code).toBe('forbidden')
  })
})

describe('efeitos nas funções de cliente do painel', () => {
  test('anonymizeCustomer pelo painel também apaga tokens, dispositivos e códigos do cliente', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER')
    const { c } = await clienteApp(b.id)
    await comSessaoDispositivoECodigo(b.id, c.id, 'maria@exemplo.test')
    await anonymizeCustomer(dono, c.id)
    expect(await prisma.refreshToken.count({ where: { customerId: c.id } })).toBe(0)
    expect(await prisma.device.count({ where: { customerId: c.id } })).toBe(0)
    expect(await prisma.verificationCode.count()).toBe(0)
  })

  test('archiveCustomer revoga os tokens de renovação', async () => {
    const b = await makeBusiness()
    const dono = await ctxWithRole(b, 'OWNER')
    const { c } = await clienteApp(b.id)
    await comSessaoDispositivoECodigo(b.id, c.id, 'maria@exemplo.test')
    await archiveCustomer(dono, c.id)
    expect(await prisma.refreshToken.count({ where: { customerId: c.id, revokedAt: null } })).toBe(0)
    expect(await prisma.refreshToken.count({ where: { customerId: c.id } })).toBe(1)
    // Os dispositivos ficam (arquivar não é apagar).
    expect(await prisma.device.count({ where: { customerId: c.id } })).toBe(1)
  })
})
