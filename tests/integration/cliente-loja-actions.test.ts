import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { entrarComoCliente, form } from '../setup/cliente'
import { cenaLoja, produto } from '../setup/store'

const jar = new Map<string, string>()
const gravados: { name: string; value: string; options: Record<string, unknown> }[] = []
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      gravados.push({ name, value, options })
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { mudarQuantidade, porNoCarrinho, tirarDoCarrinho } from '@/app/app/[slug]/loja/actions'
import { CART_COOKIE } from '@/app/app/[slug]/loja/_lib/carrinho'
import { ESTADO_VAZIO } from '@/app/app/[slug]/_lib/estado'

async function montar(o: { modulo?: boolean } = {}) {
  const s = await cenaLoja({ ...(o.modulo === undefined ? {} : { modulo: o.modulo }) })
  const slug = (await prisma.business.findUniqueOrThrow({ where: { id: s.b.id } })).slug
  await entrarComoCliente(jar, s.b.id, s.cliente.id)
  return { ...s, slug }
}
type Cena = Awaited<ReturnType<typeof montar>>
const lerCarrinho = (): unknown => (jar.has(CART_COOKIE) ? JSON.parse(jar.get(CART_COOKIE) ?? '[]') : [])
const pôr = (c: Cena, productId: string, quantity: string) => porNoCarrinho(c.slug, ESTADO_VAZIO, form({ productId, quantity }))

beforeEach(async () => {
  jar.clear()
  gravados.length = 0
  await resetDb()
})

describe('porNoCarrinho', () => {
  test('grava o cookie com o caminho da loja, httpOnly e 30 dias', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 10 })
    const r = await pôr(c, p.id, '2')
    expect(r).toMatchObject({ ok: true, message: 'Pôs Shampoo no carrinho.' })
    expect(lerCarrinho()).toEqual([{ productId: p.id, quantity: 2 }])
    expect(gravados.at(-1)).toMatchObject({ name: 'af_carrinho', options: { httpOnly: true, sameSite: 'lax', path: `/${c.slug}`, maxAge: 2_592_000 } })
  })

  test('pôr de novo soma na mesma linha', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 10 })
    await pôr(c, p.id, '2')
    await pôr(c, p.id, '3')
    expect(lerCarrinho()).toEqual([{ productId: p.id, quantity: 5 }])
  })

  test('produto arquivado ou de outra loja → "Produto não encontrado." e cookie intacto', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 10 })
    await pôr(c, p.id, '1')
    const antes = jar.get(CART_COOKIE)
    await prisma.product.update({ where: { id: p.id }, data: { archivedAt: new Date() } })
    expect(await pôr(c, p.id, '1')).toMatchObject({ ok: false, message: 'Produto não encontrado.' })
    const outra = await cenaLoja()
    const alheio = await produto(outra.dono, { stock: 10 })
    expect(await pôr(c, alheio.id, '1')).toMatchObject({ ok: false, message: 'Produto não encontrado.' })
    expect(jar.get(CART_COOKIE)).toBe(antes)
  })

  test('mais do que o estoque ou esgotado → mensagem do domínio, cookie intacto', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 3 })
    expect(await pôr(c, p.id, '4')).toMatchObject({ ok: false, message: 'Só restam 3 unidades de Shampoo.' })
    const zero = await produto(c.dono, { stock: 0, name: 'Coleira' })
    expect(await pôr(c, zero.id, '1')).toMatchObject({ ok: false, message: 'Coleira está esgotado.' })
    expect(jar.has(CART_COOKIE)).toBe(false)
  })

  test('quantidade ilegível volta como erro no campo', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 10 })
    expect(await pôr(c, p.id, 'abc')).toMatchObject({ ok: false, fields: { quantity: 'Informe a quantidade, de 1 a 99.' } })
    expect(await pôr(c, p.id, '100')).toMatchObject({ ok: false })
  })

  test('módulo loja desligado → mensagem de módulo', async () => {
    const c = await montar({ modulo: false })
    const r = await pôr(c, '5f0e2f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6', '1')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/módulo/i)
  })

  test('sem cliente da loja: vai para a entrada e o cookie não muda', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 10 })
    jar.clear()
    await expect(pôr(c, p.id, '1')).rejects.toMatchObject({ to: expect.stringContaining('/entrar?volta=') })
    expect(gravados).toHaveLength(0)
  })

  test('o 21º produto diferente é recusado', async () => {
    const c = await montar()
    for (let i = 0; i < 20; i++) expect((await pôr(c, (await produto(c.dono, { stock: 5, name: `P${i}` })).id, '1')).ok).toBe(true)
    const extra = await produto(c.dono, { stock: 5, name: 'Extra' })
    expect(await pôr(c, extra.id, '1')).toMatchObject({ ok: false, message: 'O carrinho aceita até 20 produtos diferentes. Tire um para pôr este.' })
  })
})

describe('mudarQuantidade e tirarDoCarrinho', () => {
  test('mudar além do estoque → mensagem do domínio; dentro do estoque grava', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 4 })
    await pôr(c, p.id, '1')
    expect(await mudarQuantidade(c.slug, ESTADO_VAZIO, form({ productId: p.id, quantity: '5' }))).toMatchObject({ ok: false, message: 'Só restam 4 unidades de Shampoo.' })
    expect(lerCarrinho()).toEqual([{ productId: p.id, quantity: 1 }])
    expect((await mudarQuantidade(c.slug, ESTADO_VAZIO, form({ productId: p.id, quantity: '4' }))).ok).toBe(true)
    expect(lerCarrinho()).toEqual([{ productId: p.id, quantity: 4 }])
  })

  test('quantidade 0 tira o item; produto fora do carrinho não muda nada', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 4 })
    const q = await produto(c.dono, { stock: 4, name: 'Escova' })
    await pôr(c, p.id, '1')
    expect(await mudarQuantidade(c.slug, ESTADO_VAZIO, form({ productId: q.id, quantity: '2' }))).toMatchObject({ ok: false, message: 'Este item não está no seu carrinho.' })
    expect((await mudarQuantidade(c.slug, ESTADO_VAZIO, form({ productId: p.id, quantity: '0' }))).ok).toBe(true)
    expect(jar.has(CART_COOKIE)).toBe(false)
  })

  test('tirar deixa as outras linhas e apaga o cookie quando esvazia', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 4 })
    const q = await produto(c.dono, { stock: 4, name: 'Escova' })
    await pôr(c, p.id, '1')
    await pôr(c, q.id, '2')
    await tirarDoCarrinho(c.slug, ESTADO_VAZIO, form({ productId: p.id }))
    expect(lerCarrinho()).toEqual([{ productId: q.id, quantity: 2 }])
    await tirarDoCarrinho(c.slug, ESTADO_VAZIO, form({ productId: q.id }))
    expect(jar.has(CART_COOKIE)).toBe(false)
    expect(gravados.at(-1)).toMatchObject({ options: { maxAge: 0, path: `/${c.slug}` } })
  })

  test('item que a loja arquivou ainda pode ser tirado', async () => {
    const c = await montar()
    const p = await produto(c.dono, { stock: 4 })
    await pôr(c, p.id, '1')
    await prisma.product.update({ where: { id: p.id }, data: { archivedAt: new Date() } })
    expect((await tirarDoCarrinho(c.slug, ESTADO_VAZIO, form({ productId: p.id }))).ok).toBe(true)
    expect(jar.has(CART_COOKIE)).toBe(false)
  })
})

