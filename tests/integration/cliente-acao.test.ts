import { beforeEach, describe, expect, test, vi } from 'vitest'
import { APP_COOKIE } from '@/server/auth/guards'
import { loginWithPassword } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import type { FormState } from '@/app/_lib/form-state'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeUser } from '../setup/factories'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to, digest: `NEXT_REDIRECT;replace;${to};307;` })
  },
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND')
  },
  unstable_rethrow: (e: unknown): void => {
    if (e instanceof Error && e.message.startsWith('NEXT_')) throw e
  },
}))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { clienteAction } from '@/app/app/[slug]/_lib/acao'
import { consultar } from '@/app/app/[slug]/_lib/consulta'

const SENHA = 'senha-bem-longa'
type V = { texto: string }
const ini: FormState<V> = { ok: false, message: null, fields: {}, values: { texto: '' } }

const run = vi.fn<(v: unknown, x: V) => Promise<string>>(async () => 'feito')
const acao = clienteAction<V, string>(
  (fd) => ({ texto: String(fd.get('texto') ?? '') }),
  run,
  (r, values) => ({ ok: true, message: r, fields: {}, values }),
)
function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let a: { id: string }
let customerA: string
beforeEach(async () => {
  await resetDb()
  jar.clear()
  run.mockClear()
  await makeBusiness({ slug: 'loja-a' }).then((x) => (a = x))
  await makeBusiness({ slug: 'loja-b' })
})

async function entrarComoClienteDeA(): Promise<void> {
  const u = await makeUser({ password: SENHA })
  customerA = (await makeCustomer(a.id, { userId: u.id })).id
  jar.set(APP_COOKIE, (await loginWithPassword({ email: u.email, password: SENHA, customerBusinessId: a.id }, new Date())).token)
}

describe('clienteAction', () => {
  test('sem sessão: vai para entrar com o volta, e run não roda', async () => {
    await expect(acao('loja-a', ini, form({ texto: 'x' }))).rejects.toMatchObject({ to: '/loja-a/entrar?volta=%2Floja-a' })
    expect(run).not.toHaveBeenCalled()
  })

  test('visitante (pessoa sem vínculo): vai para a página da loja', async () => {
    const u = await makeUser({ password: SENHA })
    jar.set(APP_COOKIE, (await loginWithPassword({ email: u.email, password: SENHA }, new Date())).token)
    await expect(acao('loja-a', ini, form({ texto: 'x' }))).rejects.toMatchObject({ to: '/loja-a?volta=%2Floja-a' })
    expect(run).not.toHaveBeenCalled()
  })

  test('slug de outra loja com a sessão de cliente de A: visitante em B, run não é chamado', async () => {
    await entrarComoClienteDeA()
    await expect(acao('loja-b', ini, form({ texto: 'x' }))).rejects.toMatchObject({ to: '/loja-b?volta=%2Floja-b' })
    expect(run).not.toHaveBeenCalled()
  })

  test('loja indisponível: vai para o endereço da loja', async () => {
    await entrarComoClienteDeA()
    await expect(acao('nao-existe', ini, form({}))).rejects.toMatchObject({ to: '/nao-existe' })
  })

  test('cliente: run recebe o customerId da sessão mesmo com customerId forjado no formulário', async () => {
    await entrarComoClienteDeA()
    const outro = await makeCustomer(a.id)
    const r = await acao('loja-a', ini, form({ texto: 'oi', customerId: outro.id }))
    expect(r).toMatchObject({ ok: true, message: 'feito', values: { texto: 'oi' } })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toMatchObject({ kind: 'customer', customerId: customerA })
  })

  test('erro de domínio vira mensagem; outro erro vira a genérica', async () => {
    await entrarComoClienteDeA()
    run.mockRejectedValueOnce(new DomainError('conflict', 'Já existe.'))
    expect(await acao('loja-a', ini, form({ texto: 'x' }))).toMatchObject({ ok: false, message: 'Já existe.' })
    run.mockRejectedValueOnce(new Error('boom com dado secreto'))
    const r = await acao('loja-a', ini, form({ texto: 'x' }))
    expect(r.ok).toBe(false)
    expect(r.message).not.toContain('secreto')
  })

  test('cliente arquivado entre abrir a página e tocar: a ação leva à loja e não roda', async () => {
    await entrarComoClienteDeA()
    await prisma.customer.update({ where: { id: customerA }, data: { archivedAt: new Date() } })
    await expect(acao('loja-a', ini, form({ texto: 'x' }))).rejects.toMatchObject({ to: '/loja-a?volta=%2Floja-a' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('consultar', () => {
  test('sem cliente: pede para entrar de novo, sem redirecionar', async () => {
    expect(await consultar('loja-a', async () => ({ x: 1 }))).toEqual({ ok: false, message: 'Entre de novo para continuar.', reentrar: '/loja-a/entrar' })
  })

  test('cliente: devolve o dado; erro de domínio vira mensagem; outro erro, a genérica', async () => {
    await entrarComoClienteDeA()
    expect(await consultar('loja-a', async (v) => ({ id: v.customerId }))).toEqual({ ok: true, id: customerA })
    expect(await consultar('loja-a', async () => { throw new DomainError('not_found', 'Não achei.') })).toEqual({ ok: false, message: 'Não achei.', reentrar: null })
    const r = await consultar('loja-a', async () => { throw new Error('segredo') })
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('segredo')
  })
})
