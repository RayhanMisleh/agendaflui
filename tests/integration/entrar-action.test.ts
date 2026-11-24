import { beforeEach, expect, test, vi } from 'vitest'
import { entrar } from '@/app/app/(entrada)/entrar/actions'
import { APP_COOKIE } from '@/server/auth/guards'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makeUser } from '../setup/factories'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      if (options['maxAge'] === 0) jar.delete(name)
      else jar.set(name, value)
    },
  }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to })
  },
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

const SENHA = 'senha-bem-longa'
const ini = { error: null, email: '' }

function form(email: string, password: string): FormData {
  const fd = new FormData()
  fd.set('email', email)
  fd.set('password', password)
  return fd
}

beforeEach(async () => {
  jar.clear()
  await resetDb()
})

test('equipe → redirect /painel, com cookie e sessão gravada', async () => {
  const u = await makeUser({ password: SENHA })
  await makeMembership((await makeBusiness()).id, u.id, 'OWNER')
  await expect(entrar(ini, form(u.email, SENHA))).rejects.toMatchObject({ to: '/painel' })
  expect(jar.has(APP_COOKIE)).toBe(true)
  expect(await prisma.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(1)
})

test('cliente de uma loja → redirect /<slug>', async () => {
  const u = await makeUser({ password: SENHA })
  const b = await makeBusiness({ slug: 'demo-x' })
  await makeCustomer(b.id, { userId: u.id })
  await expect(entrar(ini, form(u.email, SENHA))).rejects.toMatchObject({ to: '/demo-x' })
})

test('ninguém (sem equipe e sem loja) → redirect /', async () => {
  const u = await makeUser({ password: SENHA })
  await expect(entrar(ini, form(u.email, SENHA))).rejects.toMatchObject({ to: '/' })
})

test('senha errada → estado com "E-mail ou senha incorretos." e sem cookie', async () => {
  const u = await makeUser({ password: SENHA })
  expect(await entrar(ini, form(u.email, 'errada-errada'))).toEqual({ error: 'E-mail ou senha incorretos.', email: u.email })
  expect(jar.has(APP_COOKIE)).toBe(false)
})

test('conta pendente (sem senha) recebe a mesma mensagem', async () => {
  const u = await makeUser({ password: null })
  expect((await entrar(ini, form(u.email, 'qualquer-coisa-aqui'))).error).toBe('E-mail ou senha incorretos.')
})

test('dados inválidos → pede e-mail e senha', async () => {
  expect((await entrar(ini, form('nao-e-email', ''))).error).toMatch(/Informe um e-mail válido/)
})
