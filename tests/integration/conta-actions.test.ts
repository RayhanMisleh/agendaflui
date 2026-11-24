import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setAfterScheduler } from '@/server/after'
import { APP_COOKIE } from '@/server/auth/guards'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'
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
  unstable_rethrow: (e: unknown): void => {
    if (e instanceof Error && e.message.startsWith('NEXT_')) throw e
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import {
  confirmarEmail,
  desvincularGoogle,
  pedirCodigoDeEmail,
  salvarAvisosDaLoja,
  salvarDados,
  salvarSenha,
  sair,
  trocarLoja,
} from '@/app/app/conta/actions'
import { ESTADO_CONTA } from '@/app/app/conta/_lib/estado'

const SENHA = 'senha-bem-longa'
const GOOGLE = { sub: 'sub-1', email: 'rita@exemplo.test' }
const mail = fakeMail()
let tarefas: (() => Promise<void>)[]

const form = (campos: Record<string, string>): FormData => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

async function entrar(userId: string, token = 'tok-conta'): Promise<string> {
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: addMinutes(new Date(), 600) } })
  jar.set(APP_COOKIE, token)
  return token
}

beforeEach(async () => {
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

describe('sessão', () => {
  test('sem sessão, qualquer ação vai para a entrada', async () => {
    await expect(salvarDados(ESTADO_CONTA, form({ name: 'X' }))).rejects.toMatchObject({ to: '/entrar' })
  })

  test('sessão de suporte (sem pessoa) vai para /painel', async () => {
    const admin = await makePlatformAdmin()
    const b = await makeBusiness()
    await prisma.session.create({
      data: { impersonatorAdminId: admin.id, activeBusinessId: b.id, tokenHash: hashToken('sup'), expiresAt: addMinutes(new Date(), 60) },
    })
    jar.set(APP_COOKIE, 'sup')
    await expect(salvarDados(ESTADO_CONTA, form({ name: 'X' }))).rejects.toMatchObject({ to: '/painel' })
  })
})

describe('dados e senha', () => {
  test('salvarDados usa o userId da sessão, nunca o do formulário', async () => {
    const eu = await makeUser({ name: 'Eu' })
    const outro = await makeUser({ name: 'Outro' })
    await entrar(eu.id)
    const r = await salvarDados(ESTADO_CONTA, form({ userId: outro.id, name: 'Eu Mesmo', phone: '(11) 91234-5678' }))
    expect(r).toMatchObject({ ok: true, message: 'Dados salvos.' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: eu.id } })).name).toBe('Eu Mesmo')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: outro.id } })).name).toBe('Outro')
  })

  test('nome vazio volta como erro de campo', async () => {
    const eu = await makeUser()
    await entrar(eu.id)
    const r = await salvarDados(ESTADO_CONTA, form({ name: ' ', phone: '' }))
    expect(r.ok).toBe(false)
    expect(r.fields['name']).toBeDefined()
  })

  test('salvarSenha: confirmação diferente e senha atual errada voltam por campo, sem devolver senha', async () => {
    const eu = await makeUser({ password: SENHA })
    await entrar(eu.id)
    const a = await salvarSenha(ESTADO_CONTA, form({ senhaAtual: SENHA, senhaNova: 'nova-senha-longa-1', senhaConfirma: 'diferente-longa-1' }))
    expect(a.fields['senhaConfirma']).toBeDefined()
    const b = await salvarSenha(ESTADO_CONTA, form({ senhaAtual: 'errada-errada-1', senhaNova: 'nova-senha-longa-1', senhaConfirma: 'nova-senha-longa-1' }))
    expect(b.fields['senhaAtual']).toBeDefined()
    expect(JSON.stringify([a, b])).not.toContain('nova-senha-longa-1')
    const c = await salvarSenha(ESTADO_CONTA, form({ senhaAtual: SENHA, senhaNova: 'nova-senha-longa-1', senhaConfirma: 'nova-senha-longa-1' }))
    expect(c).toMatchObject({ ok: true, message: 'Senha salva.' })
  })
})

describe('e-mail', () => {
  test('pede o código (envio depois da resposta), confirma e troca', async () => {
    const eu = await makeUser({ password: SENHA, email: 'velho@exemplo.test' })
    await entrar(eu.id)
    const p = await pedirCodigoDeEmail(ESTADO_CONTA, form({ email: 'novo@exemplo.test' }))
    expect(p).toMatchObject({ step: 'codigo', sent: 1, values: { email: 'novo@exemplo.test' } })
    for (const t of tarefas) await t()
    expect(mail.sent).toHaveLength(1)
    const c = await confirmarEmail(p, form({ email: 'novo@exemplo.test', code: mail.codeOf() }))
    expect(c).toMatchObject({ ok: true, message: 'E-mail trocado.' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: eu.id } })).email).toBe('novo@exemplo.test')
  })

  test('só Google: needs_password vira needsPassword e a frase da regra 9', async () => {
    const eu = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    await entrar(eu.id)
    const p = await pedirCodigoDeEmail(ESTADO_CONTA, form({ email: 'novo@exemplo.test' }))
    expect(p).toMatchObject({ ok: false, step: 'email', needsPassword: true, message: 'Crie uma senha antes de trocar o e-mail.' })
    expect(tarefas).toHaveLength(0)
  })

  test('código errado: erro no campo do código, continua no passo do código', async () => {
    const eu = await makeUser({ password: SENHA })
    await entrar(eu.id)
    const p = await pedirCodigoDeEmail(ESTADO_CONTA, form({ email: 'novo@exemplo.test' }))
    for (const t of tarefas) await t()
    const certo = mail.codeOf()
    const r = await confirmarEmail(p, form({ email: 'novo@exemplo.test', code: certo === '000000' ? '111111' : '000000' }))
    expect(r.ok).toBe(false)
    expect(r.step).toBe('codigo')
    expect(r.fields['code']).toBeDefined()
  })

  test('troca com Google de outro e-mail avisa que o Google foi desvinculado', async () => {
    const eu = await makeUser({ password: SENHA, google: GOOGLE, email: GOOGLE.email })
    await entrar(eu.id)
    const p = await pedirCodigoDeEmail(ESTADO_CONTA, form({ email: 'novo@exemplo.test' }))
    for (const t of tarefas) await t()
    const c = await confirmarEmail(p, form({ email: 'novo@exemplo.test', code: mail.codeOf() }))
    expect(c.message).toBe('E-mail trocado. O Google foi desvinculado.')
  })
})

describe('Google', () => {
  test('desvincularGoogle sem senha devolve a frase da regra 7 com needsPassword', async () => {
    const eu = await makeUser({ google: GOOGLE, email: GOOGLE.email })
    await entrar(eu.id)
    const r = await desvincularGoogle(ESTADO_CONTA)
    expect(r).toMatchObject({ ok: false, needsPassword: true, message: 'Crie uma senha antes de desvincular, para não perder o acesso.' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: eu.id } })).googleSub).toBe(GOOGLE.sub)
  })

  test('desvincularGoogle com senha desvincula', async () => {
    const eu = await makeUser({ google: GOOGLE, email: GOOGLE.email, password: SENHA })
    await entrar(eu.id)
    expect(await desvincularGoogle(ESTADO_CONTA)).toMatchObject({ ok: true, message: 'Google desvinculado.' })
  })
})

describe('lojas e avisos', () => {
  test('trocarLoja redireciona para /<slug>; loja alheia: "Escolha uma das suas lojas."', async () => {
    const eu = await makeUser()
    const a = await makeBusiness({ slug: 'loja-a' })
    const alheia = await makeBusiness({ slug: 'loja-z' })
    await makeCustomer(a.id, { userId: eu.id })
    await entrar(eu.id)
    await expect(trocarLoja(ESTADO_CONTA, form({ businessId: a.id }))).rejects.toMatchObject({ to: '/loja-a' })
    const r = await trocarLoja(ESTADO_CONTA, form({ businessId: alheia.id }))
    expect(r).toMatchObject({ ok: false, message: 'Escolha uma das suas lojas.' })
  })

  test('salvarAvisosDaLoja: gerente liga e desliga; profissional recebe forbidden', async () => {
    const loja = await makeBusiness()
    const gerente = await makeUser()
    const m = await makeMembership(loja.id, gerente.id, 'MANAGER')
    await entrar(gerente.id, 'tok-g')
    expect(await salvarAvisosDaLoja(ESTADO_CONTA, form({ value: 'on' }))).toMatchObject({ ok: true })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).notifyAllAppointments).toBe(true)
    await salvarAvisosDaLoja(ESTADO_CONTA, form({ value: '' }))
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).notifyAllAppointments).toBe(false)

    const prof = await makeUser()
    const mp = await makeMembership(loja.id, prof.id, 'PROFESSIONAL')
    await entrar(prof.id, 'tok-p')
    const r = await salvarAvisosDaLoja(ESTADO_CONTA, form({ value: 'on' }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Só o dono e o gerente/)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: mp.id } })).notifyAllAppointments).toBe(false)
  })

  test('sair revoga a sessão e vai para /entrar', async () => {
    const eu = await makeUser()
    await entrar(eu.id)
    await expect(sair()).rejects.toMatchObject({ to: '/entrar' })
    expect((await prisma.session.findFirstOrThrow({ where: { userId: eu.id } })).revokedAt).not.toBeNull()
  })
})
