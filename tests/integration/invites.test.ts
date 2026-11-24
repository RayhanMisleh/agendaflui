import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { hashToken } from '@/server/auth/tokens'
import { verifyPassword } from '@/server/auth/password'
import { prisma } from '@/server/db/client'
import { acceptInvite, issueInvite, readInvite } from '@/server/auth/invites'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeUser } from '../setup/factories'

vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  },
}))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7' }) }))

const AGORA = new Date('2026-11-16T12:00:00.000Z')
const SENHA = 'uma-senha-bem-longa'

beforeEach(async () => {
  await resetDb()
})
afterEach(() => vi.restoreAllMocks())

async function novoConvite(now = AGORA) {
  const user = await makeUser({ name: 'João Silva', email: 'joao@exemplo.test', password: null })
  const convite = await prisma.$transaction((tx) => issueInvite(tx, user.id, now))
  return { user, ...convite }
}

describe('issueInvite', () => {
  test('token opaco de 32 bytes, só o hash no banco, validade de 7 dias', async () => {
    const { user, token, expiresAt } = await novoConvite()
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(expiresAt).toEqual(addMinutes(AGORA, 7 * 24 * 60))
    const linha = await prisma.userToken.findFirstOrThrow({ where: { userId: user.id } })
    expect(linha).toMatchObject({ purpose: 'INVITE', tokenHash: hashToken(token), usedAt: null })
    expect(linha.expiresAt).toEqual(expiresAt)
    expect(JSON.stringify(await prisma.$queryRaw`SELECT to_jsonb(t) AS j FROM user_tokens t`)).not.toContain(token)
  })

  test('novo convite invalida o anterior', async () => {
    const { user, token: velho } = await novoConvite()
    const { token: novo } = await prisma.$transaction((tx) => issueInvite(tx, user.id, AGORA))
    expect(novo).not.toBe(velho)
    expect(await readInvite(velho, AGORA)).toBeNull()
    expect(await readInvite(novo, AGORA)).toEqual({ userName: 'João Silva', email: 'joao@exemplo.test' })
    expect((await domainError(acceptInvite({ token: velho, password: SENHA }, AGORA))).code).toBe('not_found')
    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(1)
  })
})

describe('readInvite', () => {
  test('devolve nome e e-mail; vencido, desconhecido e usado devolvem null', async () => {
    const { token, expiresAt } = await novoConvite()
    expect(await readInvite(token, AGORA)).toEqual({ userName: 'João Silva', email: 'joao@exemplo.test' })
    expect(await readInvite(token, expiresAt)).toBeNull()
    expect(await readInvite(token, addMinutes(expiresAt, 1))).toBeNull()
    expect(await readInvite('token-que-nao-existe', AGORA)).toBeNull()
    expect(await readInvite('', AGORA)).toBeNull()
    await acceptInvite({ token, password: SENHA }, AGORA)
    expect(await readInvite(token, AGORA)).toBeNull()
  })
})

describe('acceptInvite', () => {
  test('define a senha (argon2), consome o token e o segundo uso falha', async () => {
    const { user, token } = await novoConvite()
    await acceptInvite({ token, password: SENHA }, AGORA)
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(depois.passwordHash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(depois.passwordHash ?? '', SENHA)).toBe(true)
    expect((await prisma.userToken.findFirstOrThrow({ where: { userId: user.id } })).usedAt).toEqual(AGORA)
    const e = await domainError(acceptInvite({ token, password: 'outra-senha-bem-longa' }, AGORA))
    expect(e.code).toBe('not_found')
    expect(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash ?? '', SENHA)).toBe(true)
  })

  test('convite vencido, desconhecido e vazio dão a mesma resposta', async () => {
    const { token, expiresAt } = await novoConvite()
    const vencido = await domainError(acceptInvite({ token, password: SENHA }, addMinutes(expiresAt, 1)))
    const desconhecido = await domainError(acceptInvite({ token: 'x'.repeat(43), password: SENHA }, AGORA))
    const vazio = await domainError(acceptInvite({ token: '', password: SENHA }, AGORA))
    expect(vencido.code).toBe('not_found')
    expect(desconhecido.message).toBe(vencido.message)
    expect(vazio.message).toBe(vencido.message)
    expect(vencido.reason).toBe(desconhecido.reason)
    expect((await prisma.user.findFirstOrThrow()).passwordHash).toBeNull()
  })

  test('senha curta falha no campo password e não consome o convite', async () => {
    const { token } = await novoConvite()
    const e = await domainError(acceptInvite({ token, password: 'curta' }, AGORA))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('password')
    expect(await readInvite(token, AGORA)).not.toBeNull()
  })

  test('duas aceitações simultâneas: uma passa e a outra falha', async () => {
    const { user, token } = await novoConvite()
    const res = await Promise.allSettled([
      acceptInvite({ token, password: 'primeira-senha-longa' }, AGORA),
      acceptInvite({ token, password: 'segunda-senha-longa' }, AGORA),
    ])
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(res.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash ?? ''
    const venceu = res[0]?.status === 'fulfilled' ? 'primeira-senha-longa' : 'segunda-senha-longa'
    expect(await verifyPassword(hash, venceu)).toBe(true)
  })

  test('revoga as sessões antigas do usuário e só dele', async () => {
    const { user, token } = await novoConvite()
    const outro = await makeUser()
    const futuro = new Date(Date.now() + 3_600_000)
    const antiga = await prisma.session.create({ data: { userId: user.id, tokenHash: 'a1', expiresAt: futuro } })
    const alheia = await prisma.session.create({ data: { userId: outro.id, tokenHash: 'a2', expiresAt: futuro } })
    await acceptInvite({ token, password: SENHA }, AGORA)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: antiga.id } })).revokedAt).toEqual(AGORA)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: alheia.id } })).revokedAt).toBeNull()
  })

  test('usuário que já tem senha: o convite é inválido, o token é consumido e a senha não muda', async () => {
    const { user, token } = await novoConvite()
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: 'hash-existente' } })
    const e = await domainError(acceptInvite({ token, password: SENHA }, AGORA))
    expect(e.code).toBe('not_found')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe('hash-existente')
    expect((await prisma.userToken.findFirstOrThrow({ where: { userId: user.id } })).usedAt).toEqual(AGORA)
  })

  test('issueInvite recusa usuário que já tem senha', async () => {
    const user = await makeUser({ password: 'senha-bem-longa' })
    await expect(prisma.$transaction((tx) => issueInvite(tx, user.id, AGORA))).rejects.toMatchObject({ code: 'conflict' })
    expect(await prisma.userToken.count()).toBe(0)
  })

  test('um token de outro propósito não serve de convite', async () => {
    const user = await makeUser({ password: null })
    await prisma.userToken.create({ data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: hashToken('reset'), expiresAt: addMinutes(AGORA, 60) } })
    expect(await readInvite('reset', AGORA)).toBeNull()
    expect((await domainError(acceptInvite({ token: 'reset', password: SENHA }, AGORA))).code).toBe('not_found')
  })
})

describe('ação de servidor da tela de definir senha', () => {
  async function chamar(token: string, password: string, confirm = password) {
    const { definirSenha } = await import('@/app/app/(entrada)/convite/[token]/actions')
    const form = new FormData()
    form.set('token', token)
    form.set('password', password)
    form.set('confirm', confirm)
    try {
      return await definirSenha({ error: null, fields: {} }, form)
    } catch (e) {
      if (e instanceof Error && e.message === 'NEXT_REDIRECT') return { redirectedTo: (e as unknown as { to: string }).to }
      throw e
    }
  }

  test('sucesso: grava a senha e manda para /entrar', async () => {
    const { user, token } = await novoConvite(new Date())
    const r = await chamar(token, SENHA)
    expect(r).toEqual({ redirectedTo: '/entrar' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).not.toBeNull()
  })

  test('token inexistente e token vencido recebem a mesma mensagem, sem dizer qual', async () => {
    const { token } = await novoConvite(addMinutes(new Date(), -8 * 24 * 60))
    const vencido = await chamar(token, SENHA)
    const inexistente = await chamar('x'.repeat(43), SENHA)
    expect(vencido).toMatchObject({ error: expect.stringContaining('convite') })
    expect(vencido).toEqual(inexistente)
  })

  test('senhas diferentes ou curtas voltam com o erro no campo e não consomem o convite', async () => {
    const { token } = await novoConvite(new Date())
    const diferente = await chamar(token, SENHA, 'outra-coisa-bem-longa')
    expect(diferente).toMatchObject({ fields: { confirm: expect.any(String) } })
    const curta = await chamar(token, 'curta')
    expect(curta).toMatchObject({ fields: { password: expect.any(String) } })
    expect(await readInvite(token, new Date())).not.toBeNull()
  })

  test('limite de tentativas por IP: passado o teto, responde com espera mesmo com token certo', async () => {
    const { token } = await novoConvite(new Date())
    let ultima: unknown
    for (let n = 0; n < 31; n++) ultima = await chamar('y'.repeat(43), SENHA)
    expect(ultima).toMatchObject({ error: expect.stringMatching(/Muitas tentativas/) })
    expect(await chamar(token, SENHA)).toMatchObject({ error: expect.stringMatching(/Muitas tentativas/) })
    expect(await readInvite(token, new Date())).not.toBeNull()
  })

  test('sem IP confiável o limite é por token: tokens lixo diferentes não travam um convite válido', async () => {
    vi.doMock('@/server/auth/request-info', () => ({ requestInfo: async () => ({}) }))
    vi.resetModules()
    const { definirSenha } = await import('@/app/app/(entrada)/convite/[token]/actions')
    const { token } = await novoConvite(new Date())
    const tentar = async (t: string) => {
      const form = new FormData()
      form.set('token', t)
      form.set('password', SENHA)
      form.set('confirm', SENHA)
      try {
        return await definirSenha({ error: null, fields: {} }, form)
      } catch (e) {
        return { redirectedTo: (e as unknown as { to: string }).to }
      }
    }
    for (let n = 0; n < 40; n++) await tentar(`lixo-${n}`)
    expect(await tentar(token)).toEqual({ redirectedTo: '/entrar' })
    // O mesmo token lixo repetido esgota o contador dele.
    let r: unknown
    for (let n = 0; n < 31; n++) r = await tentar('sempre-o-mesmo')
    expect(r).toMatchObject({ error: expect.stringMatching(/Muitas tentativas/) })
    vi.doUnmock('@/server/auth/request-info')
    vi.resetModules()
  })
})
