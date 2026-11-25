import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setAfterScheduler } from '@/server/after'
import { APP_COOKIE } from '@/server/auth/guards'
import { getPersonSession } from '@/server/auth/session'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

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
const quiz = vi.hoisted(() => ({ needs: vi.fn(async () => false) }))
vi.mock('@/server/auth/pet-onboarding', () => ({ needsPetQuiz: quiz.needs }))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { entrarNaLoja } from '@/app/app/[slug]/(acesso)/entrar/actions'
import { concluirCadastro, confirmarCadastro, pedirCodigo } from '@/app/app/[slug]/(acesso)/cadastro/actions'
import { usarMinhaConta } from '@/app/app/[slug]/actions'

const SENHA = 'senha-bem-longa'
const mail = fakeMail()
let tarefas: (() => Promise<void>)[]

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

beforeEach(async () => {
  quiz.needs.mockReset()
  quiz.needs.mockResolvedValue(false)
  jar.clear()
  await resetDb()
  mail.install()
  tarefas = []
  setAfterScheduler((t) => {
    tarefas.push(t)
  })
})
afterEach(() => {
  mail.uninstall()
  setAfterScheduler(undefined)
})

describe('/[slug]/entrar', () => {
  test('entra, vira cliente e redireciona para /<slug> com cookie', async () => {
    const b = await makeBusiness({ slug: 'pet-bom' })
    const u = await makeUser({ password: SENHA })
    await expect(entrarNaLoja({ error: null, email: '' }, form({ slug: 'pet-bom', email: u.email, password: SENHA }))).rejects.toMatchObject({ to: '/pet-bom' })
    expect(jar.has(APP_COOKIE)).toBe(true)
    expect(await prisma.customer.count({ where: { businessId: b.id, userId: u.id } })).toBe(1)
    expect(await getPersonSession(jar.get(APP_COOKIE))).toMatchObject({ customerBusinessId: b.id })
  })

  test('entrar com volta=/pet-bom/agendar e pet cadastrado vai para /pet-bom/agendar', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    const u = await makeUser({ password: SENHA })
    await expect(entrarNaLoja({ error: null, email: '' }, form({ slug: 'pet-bom', email: u.email, password: SENHA, volta: '/pet-bom/agendar' }))).rejects.toMatchObject({ to: '/pet-bom/agendar' })
  })

  test('loja pet sem pet: entrar vai para o quiz levando o volta', async () => {
    quiz.needs.mockResolvedValue(true)
    await makeBusiness({ slug: 'pet-bom' })
    const u = await makeUser({ password: SENHA })
    await expect(entrarNaLoja({ error: null, email: '' }, form({ slug: 'pet-bom', email: u.email, password: SENHA, volta: '/pet-bom/agendar' }))).rejects.toMatchObject({
      to: '/pet-bom/boas-vindas?volta=%2Fpet-bom%2Fagendar',
    })
  })

  test('volta de outra loja é ignorada', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    await makeBusiness({ slug: 'pet-mau' })
    const u = await makeUser({ password: SENHA })
    await expect(entrarNaLoja({ error: null, email: '' }, form({ slug: 'pet-bom', email: u.email, password: SENHA, volta: '/pet-mau/agendar' }))).rejects.toMatchObject({ to: '/pet-bom' })
    await expect(entrarNaLoja({ error: null, email: '' }, form({ slug: 'pet-bom', email: u.email, password: SENHA, volta: 'https://x.test/pet-bom' }))).rejects.toMatchObject({ to: '/pet-bom' })
  })

  test('senha errada: mensagem, sem cookie e sem cliente', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    const u = await makeUser({ password: SENHA })
    const r = await entrarNaLoja({ error: null, email: '' }, form({ slug: 'pet-bom', email: u.email, password: 'errada-errada' }))
    expect(r.error).toBe('E-mail ou senha incorretos.')
    expect(jar.has(APP_COOKIE)).toBe(false)
    expect(await prisma.customer.count()).toBe(0)
  })

  test('loja suspensa: mensagem clara em vez de erro cru', async () => {
    await makeBusiness({ slug: 'pet-fechado', status: 'SUSPENDED' })
    const u = await makeUser({ password: SENHA })
    const r = await entrarNaLoja({ error: null, email: '' }, form({ slug: 'pet-fechado', email: u.email, password: SENHA }))
    expect(r.error).toMatch(/não está disponível/)
  })
})

describe('/[slug]/cadastro (quiz)', () => {
  const dados = (extra: Record<string, string> = {}) => ({ slug: 'pet-bom', name: 'Ana', email: 'ana@exemplo.test', password: SENHA, ...extra })

  test('pede o código, confirma (abre a sessão e cria o cliente) e conclui sem telefone indo para /<slug>', async () => {
    const b = await makeBusiness({ slug: 'pet-bom' })
    const r = await pedirCodigo(form(dados()))
    expect(r).toEqual({ ok: true, error: null, fields: {} })
    expect(JSON.stringify(r)).not.toContain(SENHA)
    for (const t of tarefas) await t()
    expect(mail.sent).toHaveLength(1)
    expect(await confirmarCadastro(form({ slug: 'pet-bom', email: 'ana@exemplo.test', code: mail.codeOf() }))).toEqual({ ok: true, error: null, fields: {} })
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@exemplo.test' } })
    expect(u.phone).toBeNull()
    expect(await prisma.customer.count({ where: { businessId: b.id, userId: u.id } })).toBe(1)
    expect(jar.has(APP_COOKIE)).toBe(true)
    await expect(concluirCadastro(form({ slug: 'pet-bom', phone: '' }))).rejects.toMatchObject({ to: '/pet-bom' })
  })

  test('o WhatsApp do último passo vai para a pessoa e para o cliente da loja', async () => {
    const b = await makeBusiness({ slug: 'pet-bom' })
    await pedirCodigo(form(dados()))
    for (const t of tarefas) await t()
    await confirmarCadastro(form({ slug: 'pet-bom', email: 'ana@exemplo.test', code: mail.codeOf() }))
    await expect(concluirCadastro(form({ slug: 'pet-bom', phone: '(11) 91234-5678' }))).rejects.toMatchObject({ to: '/pet-bom' })
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@exemplo.test' } })
    expect(u.phone).toBe('5511912345678')
    expect((await prisma.customer.findFirstOrThrow({ where: { businessId: b.id, userId: u.id } })).phone).toBe('5511912345678')
  })

  test('telefone inválido fica no passo com o erro no campo e nada é gravado nem redirecionado', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    await pedirCodigo(form(dados()))
    for (const t of tarefas) await t()
    await confirmarCadastro(form({ slug: 'pet-bom', email: 'ana@exemplo.test', code: mail.codeOf() }))
    const r = await concluirCadastro(form({ slug: 'pet-bom', phone: 'abc' }))
    expect(r.ok).toBe(false)
    expect(r.fields['phone']).toBeDefined()
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'ana@exemplo.test' } })).phone).toBeNull()
  })

  test('sem sessão, concluir volta para a entrada da loja e não grava telefone', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    await expect(concluirCadastro(form({ slug: 'pet-bom', phone: '(11) 91234-5678' }))).rejects.toMatchObject({ to: '/pet-bom/entrar' })
  })

  test('cadastro novo de loja pet conclui em /pet-bom/boas-vindas?volta=%2Fpet-bom%2Fagendar', async () => {
    quiz.needs.mockResolvedValue(true)
    await makeBusiness({ slug: 'pet-bom' })
    await pedirCodigo(form(dados({ volta: '/pet-bom/agendar' })))
    for (const t of tarefas) await t()
    await confirmarCadastro(form({ slug: 'pet-bom', email: 'ana@exemplo.test', code: mail.codeOf() }))
    await expect(concluirCadastro(form({ slug: 'pet-bom', volta: '/pet-bom/agendar', phone: '' }))).rejects.toMatchObject({
      to: '/pet-bom/boas-vindas?volta=%2Fpet-bom%2Fagendar',
    })
  })

  test('dados inválidos voltam por campo, sem agendar envio', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    const r = await pedirCodigo(form(dados({ email: 'x', password: 'curta' })))
    expect(r.ok).toBe(false)
    expect(r.fields['email']).toBeDefined()
    expect(r.fields['password']).toBeDefined()
    expect(tarefas).toHaveLength(0)
  })

  test('código errado: erro no campo do código e sem cookie', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    await pedirCodigo(form(dados()))
    for (const t of tarefas) await t()
    const certo = mail.codeOf()
    const r = await confirmarCadastro(form({ slug: 'pet-bom', email: 'ana@exemplo.test', code: certo === '000000' ? '111111' : '000000' }))
    expect(r.ok).toBe(false)
    expect(r.fields['code']).toBeDefined()
    expect(jar.has(APP_COOKIE)).toBe(false)
  })

  test('loja inexistente: erro geral', async () => {
    const r = await pedirCodigo(form(dados({ slug: 'nao-existe' })))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/não está disponível/)
  })
})

describe('"Usar minha conta nesta loja"', () => {
  async function entrarComoPessoa(): Promise<{ userId: string; token: string }> {
    const u = await makeUser({ password: SENHA })
    const { loginWithPassword } = await import('@/server/auth/session')
    const r = await loginWithPassword({ email: u.email, password: SENHA }, new Date())
    jar.set(APP_COOKIE, r.token)
    return { userId: u.id, token: r.token }
  }

  test('liga a pessoa à loja, regrava a sessão e volta para /<slug>', async () => {
    const b = await makeBusiness({ slug: 'pet-bom' })
    const { userId, token } = await entrarComoPessoa()
    await expect(usarMinhaConta({ error: null }, form({ slug: 'pet-bom' }))).rejects.toMatchObject({ to: '/pet-bom' })
    expect(await prisma.customer.count({ where: { businessId: b.id, userId } })).toBe(1)
    expect(await prisma.session.findFirstOrThrow({ where: { tokenHash: hashToken(token) } })).toMatchObject({ customerBusinessId: b.id })
  })

  test('com volta: segue para o volta dentro da loja; volta de outra loja é ignorada', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    await entrarComoPessoa()
    await expect(usarMinhaConta({ error: null }, form({ slug: 'pet-bom', volta: '/pet-bom/agendar' }))).rejects.toMatchObject({ to: '/pet-bom/agendar' })
    await expect(usarMinhaConta({ error: null }, form({ slug: 'pet-bom', volta: '/outra/agendar' }))).rejects.toMatchObject({ to: '/pet-bom' })
  })

  test('cadastro arquivado: "Sua conta nesta loja está desativada. Fale com a loja." e nada muda', async () => {
    const b = await makeBusiness({ slug: 'pet-bom' })
    const { userId } = await entrarComoPessoa()
    await makeCustomer(b.id, { userId, archivedAt: new Date() })
    const r = await usarMinhaConta({ error: null }, form({ slug: 'pet-bom' }))
    expect(r.error).toBe('Sua conta nesta loja está desativada. Fale com a loja.')
    expect(await prisma.customer.count({ where: { businessId: b.id } })).toBe(1)
  })

  test('sem sessão: vai para /entrar', async () => {
    await makeBusiness({ slug: 'pet-bom' })
    await expect(usarMinhaConta({ error: null }, form({ slug: 'pet-bom' }))).rejects.toMatchObject({ to: '/entrar' })
  })
})
