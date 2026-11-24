import { beforeEach, describe, expect, test, vi } from 'vitest'
import { APP_COOKIE } from '@/server/auth/guards'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { entrarComoCliente, form } from '../setup/cliente'
import { makeBusiness, makeCustomer } from '../setup/factories'

const jar = new Map<string, string>()
const apagados: string[] = []
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      if (value === '') {
        apagados.push(name)
        jar.delete(name)
      } else jar.set(name, value)
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { excluirConta, salvarAvisos } from '@/app/app/[slug]/mais/actions'
import { ESTADO_VAZIO } from '@/app/app/[slug]/_lib/estado'

const SENHA = 'senha-bem-longa'

async function loja() {
  const b = await makeBusiness({ niche: 'PET' })
  const cliente = await makeCustomer(b.id, { name: 'Marina' })
  const pessoa = await entrarComoCliente(jar, b.id, cliente.id)
  return { b, slug: b.slug, cliente, pessoa }
}

beforeEach(async () => {
  jar.clear()
  apagados.length = 0
  await resetDb()
})

async function redirecionou(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof Error && 'to' in e && typeof e.to === 'string') return e.to
    throw e
  }
  throw new Error('esperava redirect')
}

describe('salvarAvisos', () => {
  test('grava só no cliente desta loja', async () => {
    const c = await loja()
    const outro = await makeCustomer(c.b.id, { name: 'Outro' })
    const r = await salvarAvisos(c.slug, ESTADO_VAZIO, form({ emailAppointments: 'on' }))
    expect(r).toMatchObject({ ok: true, message: 'Avisos salvos.' })
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).toMatchObject({ notifyEmailAppointments: true, notifyEmailMarketing: false })
    const intacto = await prisma.customer.findUniqueOrThrow({ where: { id: outro.id } })
    expect(intacto.notifyEmailMarketing).toBe(false)
    const r2 = await salvarAvisos(c.slug, ESTADO_VAZIO, form({ emailMarketing: 'on' }))
    expect(r2.ok).toBe(true)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).toMatchObject({ notifyEmailAppointments: false, notifyEmailMarketing: true })
  })

  test('visitante (sem vínculo com esta loja) é levado à loja e nada grava', async () => {
    const c = await loja()
    const outraLoja = await makeBusiness({ niche: 'PET' })
    await expect(salvarAvisos(outraLoja.slug, ESTADO_VAZIO, form({ emailMarketing: 'on' }))).rejects.toMatchObject({ to: expect.stringContaining(`/${outraLoja.slug}?volta=`) })
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).notifyEmailMarketing).toBe(false)
  })
})

describe('excluirConta', () => {
  test('senha certa: pessoa de uma loja só apagada, cookie apagado, redirect /entrar?conta=excluida', async () => {
    const c = await loja()
    const para = await redirecionou(excluirConta(c.slug, ESTADO_VAZIO, form({ password: SENHA })))
    expect(para).toBe('/entrar?conta=excluida')
    expect(await prisma.user.findUnique({ where: { id: c.pessoa.id } })).toBeNull()
    expect(apagados).toContain(APP_COOKIE)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).toMatchObject({ anonymizedAt: expect.any(Date) })
  })

  test('senha errada: fields.password e nada muda; a senha não volta ao navegador', async () => {
    const c = await loja()
    const r = await excluirConta(c.slug, ESTADO_VAZIO, form({ password: 'errada-errada-1' }))
    expect(r).toMatchObject({ ok: false, fields: { password: 'Senha incorreta.' } })
    expect(JSON.stringify(r.values)).not.toContain('errada')
    expect(await prisma.user.findUnique({ where: { id: c.pessoa.id } })).not.toBeNull()
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).anonymizedAt).toBeNull()
  })

  test('sem digitar nada: pede a confirmação', async () => {
    const c = await loja()
    expect(await excluirConta(c.slug, ESTADO_VAZIO, form({}))).toMatchObject({ ok: false, fields: { confirm: 'Confirme para excluir.' } })
  })

  test('quem só tem Google digita "excluir" (qualquer caixa)', async () => {
    const c = await loja()
    await prisma.user.update({ where: { id: c.pessoa.id }, data: { passwordHash: null } })
    expect(await excluirConta(c.slug, ESTADO_VAZIO, form({ confirm: 'sim' }))).toMatchObject({ ok: false, fields: { confirm: 'Digite excluir para confirmar.' } })
    expect(await redirecionou(excluirConta(c.slug, ESTADO_VAZIO, form({ confirm: 'Excluir' })))).toBe('/entrar?conta=excluida')
  })

  test('cliente de duas lojas: redirect para a outra loja e a pessoa continua', async () => {
    const c = await loja()
    const b2 = await makeBusiness({ niche: 'PET' })
    await makeCustomer(b2.id, { userId: c.pessoa.id, name: 'Marina' })
    const para = await redirecionou(excluirConta(c.slug, ESTADO_VAZIO, form({ password: SENHA })))
    expect(para).toBe(`/${b2.slug}`)
    expect(await prisma.user.findUnique({ where: { id: c.pessoa.id } })).not.toBeNull()
    expect(apagados).not.toContain(APP_COOKIE)
  })
})
