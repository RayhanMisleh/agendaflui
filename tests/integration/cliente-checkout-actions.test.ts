import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { resetDb } from '../setup/db'
import { entrarComoCliente, form } from '../setup/cliente'
import { enderecoDe, cotar, pedidoComRetirada, prepararEntrega } from '../setup/store-orders'
import { cenaPagamento, type CenaPagamento } from '../setup/store-payments'
import { AGORA, cenaLoja, produto } from '../setup/store'

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

import { apagarEndereco, fazerPedido, salvarEndereco } from '@/app/app/[slug]/(area)/loja/actions'
import { buscarCep, cotarFrete } from '@/app/app/[slug]/(area)/loja/consultas'
import { cancelarPedido, pagarPedido } from '@/app/app/[slug]/(area)/loja/pedidos/actions'
import { CART_COOKIE } from '@/app/app/[slug]/(area)/loja/_lib/carrinho'
import { ESTADO_VAZIO } from '@/app/app/[slug]/_lib/estado'

type Cena = CenaPagamento & { slug: string }
async function cenaComMp(): Promise<Cena> {
  const c = await cenaPagamento()
  const slug = (await prisma.business.findUniqueOrThrow({ where: { id: c.b.id } })).slug
  await entrarComoCliente(jar, c.b.id, c.cliente.id)
  // O pedido que a cena já criou (2 unidades) não é do carrinho: o teste monta o carrinho de que precisa.
  return { ...c, slug }
}
const carrinho = (productId: string, quantity: number) => jar.set(CART_COOKIE, JSON.stringify([{ productId, quantity }]))
const pedir = (c: Cena, campos: Record<string, string>) => fazerPedido(c.slug, ESTADO_VAZIO, form(campos))
const destino = async (p: Promise<unknown>): Promise<string> => {
  try {
    const r = await p
    throw new Error(`Era esperado um redirecionamento, veio ${JSON.stringify(r)}`)
  } catch (e) {
    if (e instanceof Error && 'to' in e) return String(e.to)
    throw e
  }
}

// As ações usam o relógio real; as cenas, a data fixa dos testes de loja. Só o `Date` é congelado nela (o resto do tempo anda).
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AGORA)
  jar.clear()
  gravados.length = 0
  await resetDb()
  setIntegrationsForTests(null)
})
afterEach(() => vi.useRealTimers())

describe('fazerPedido', () => {
  test('retirada: cria o pedido, limpa o carrinho e redireciona para o checkout com o backPath do pedido', async () => {
    const c = await cenaComMp()
    carrinho(c.produto.id, 2)
    const para = await destino(pedir(c, { delivery: 'PICKUP', key: 'k-1', note: ' tocar a campainha ' }))
    expect(para).toBe('https://mercadopago.fake/checkout/fake-pref-1')
    const pedidos = await prisma.order.findMany({ where: { customerId: c.cliente.id }, orderBy: { number: 'desc' } })
    expect(pedidos[0]).toMatchObject({ deliveryMethod: 'PICKUP', itemsCents: 5000, status: 'AWAITING_PAYMENT', customerNote: 'tocar a campainha' })
    expect(jar.has(CART_COOKIE)).toBe(false)
    expect(gravados.at(-1)).toMatchObject({ name: 'af_carrinho', options: { maxAge: 0, path: `/${c.slug}` } })
    expect(c.fake.preferences[0]?.backUrl).toBe(`http://app.localhost:3000/${c.slug}/loja/pedidos/${pedidos[0]?.id}`)
  })

  test('entrega com o quoteToken da cotação grava o frete', async () => {
    const c = await cenaComMp()
    await prepararEntrega(c)
    const linhas = [{ productId: c.produto.id, quantity: 2 }]
    const endereco = await enderecoDe(c.ctxCliente)
    const token = await cotar(c.ctxCliente, endereco, linhas)
    carrinho(c.produto.id, 2)
    await destino(pedir(c, { delivery: 'SHIPPING', addressId: endereco, quoteToken: token, key: 'k-2' }))
    const pedido = await prisma.order.findFirstOrThrow({ where: { customerId: c.cliente.id, deliveryMethod: 'SHIPPING' } })
    expect(pedido).toMatchObject({ itemsCents: 5000, shippingCents: 2150, totalCents: 7150 })
  })

  test('quoteToken adulterado → mensagem do domínio, nada criado e carrinho intacto', async () => {
    const c = await cenaComMp()
    await prepararEntrega(c)
    const endereco = await enderecoDe(c.ctxCliente)
    const token = await cotar(c.ctxCliente, endereco, [{ productId: c.produto.id, quantity: 2 }])
    carrinho(c.produto.id, 2)
    const antes = await prisma.order.count()
    const r = await pedir(c, { delivery: 'SHIPPING', addressId: endereco, quoteToken: `${token}x`, key: 'k-3' })
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
    expect(await prisma.order.count()).toBe(antes)
    expect(jar.has(CART_COOKIE)).toBe(true)
  })

  test('pagamento indisponível: o pedido fica aguardando e o redirect leva à tela do pedido com ?pagamento=indisponivel', async () => {
    const s = await cenaLoja()
    const slug = (await prisma.business.findUniqueOrThrow({ where: { id: s.b.id } })).slug
    await entrarComoCliente(jar, s.b.id, s.cliente.id)
    const p = await produto(s.dono, { stock: 5 })
    carrinho(p.id, 1)
    const para = await destino(fazerPedido(slug, ESTADO_VAZIO, form({ delivery: 'PICKUP', key: 'k-4' })))
    const pedido = await prisma.order.findFirstOrThrow({ where: { customerId: s.cliente.id } })
    expect(para).toBe(`/${slug}/loja/pedidos/${pedido.id}?pagamento=indisponivel`)
    expect(pedido.status).toBe('AWAITING_PAYMENT')
    expect(jar.has(CART_COOKIE)).toBe(false)
  })

  test('mesma key duas vezes: um pedido só', async () => {
    const c = await cenaComMp()
    carrinho(c.produto.id, 1)
    const antes = await prisma.order.count()
    await destino(pedir(c, { delivery: 'PICKUP', key: 'k-5' }))
    // Segundo toque com o carrinho de volta (outra aba): a mesma chave devolve o pedido já feito.
    carrinho(c.produto.id, 1)
    await destino(pedir(c, { delivery: 'PICKUP', key: 'k-5' }))
    expect(await prisma.order.count()).toBe(antes + 1)
    // Sem carrinho (o toque duplo depois do primeiro): mensagem, nada novo.
    jar.delete(CART_COOKIE)
    expect(await pedir(c, { delivery: 'PICKUP', key: 'k-5' })).toMatchObject({ ok: false, message: expect.stringContaining('carrinho está vazio') })
    expect(await prisma.order.count()).toBe(antes + 1)
  })

  test('carrinho com produto sem estoque → mensagem do domínio e nada criado', async () => {
    const c = await cenaComMp()
    carrinho(c.produto.id, 50)
    const antes = await prisma.order.count()
    const r = await pedir(c, { delivery: 'PICKUP', key: 'k-6' })
    expect(r).toMatchObject({ ok: false })
    expect(await prisma.order.count()).toBe(antes)
  })
})

describe('consultas', () => {
  test('cotarFrete com endereço de outro cliente → não encontrado', async () => {
    const c = await cenaComMp()
    await prepararEntrega(c)
    const alheio = await enderecoDe(c.ctxOutro)
    carrinho(c.produto.id, 1)
    expect(await cotarFrete(c.slug, alheio)).toEqual({ ok: false, message: 'Endereço não encontrado.', reentrar: null })
    const meu = await enderecoDe(c.ctxCliente)
    const r = await cotarFrete(c.slug, meu)
    expect(r.ok && r.cotacao.options.map((o) => o.serviceCode)).toEqual(['PAC', 'SEDEX'])
  })

  test('buscarCep devolve rua, bairro, cidade e estado; CEP inexistente volta null', async () => {
    const c = await cenaComMp()
    expect(await buscarCep(c.slug, '01310-100')).toEqual({ ok: true, endereco: { street: 'Rua das Flores', district: 'Centro', city: 'São Paulo', state: 'SP' }, indisponivel: false })
    expect(await buscarCep(c.slug, '00000000')).toEqual({ ok: true, endereco: null, indisponivel: false })
    expect(await buscarCep(c.slug, '123')).toMatchObject({ ok: false })
  })

  test('sem sessão de cliente: pede para entrar de novo, sem dado', async () => {
    const c = await cenaComMp()
    jar.clear()
    expect(await cotarFrete(c.slug, 'x')).toEqual({ ok: false, message: 'Entre de novo para continuar.', reentrar: `/${c.slug}/entrar` })
    expect(await buscarCep(c.slug, '01310100')).toMatchObject({ ok: false, reentrar: `/${c.slug}/entrar` })
  })
})

describe('pedidos de outro cliente', () => {
  test('pagarPedido e cancelarPedido de pedido de outro cliente → não encontrado, e o pedido não muda', async () => {
    const c = await cenaComMp()
    const { order } = await pedidoComRetirada(c.ctxOutro, [{ productId: c.produto.id, quantity: 1 }])
    expect(await pagarPedido(c.slug, ESTADO_VAZIO, form({ id: order.id }))).toMatchObject({ ok: false, message: 'Pedido não encontrado.' })
    expect(await cancelarPedido(c.slug, ESTADO_VAZIO, form({ id: order.id }))).toMatchObject({ ok: false, message: 'Pedido não encontrado.' })
    expect(await cancelarPedido(c.slug, ESTADO_VAZIO, form({ id: 'nao-e-id' }))).toMatchObject({ ok: false, message: 'Pedido não encontrado.' })
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('AWAITING_PAYMENT')
    expect(c.fake.preferences).toHaveLength(0)
  })

  test('o cliente paga e cancela o próprio pedido', async () => {
    const c = await cenaComMp()
    expect(await destino(pagarPedido(c.slug, ESTADO_VAZIO, form({ id: c.pedido.id })))).toBe('https://mercadopago.fake/checkout/fake-pref-1')
    expect(c.fake.preferences[0]?.backUrl).toBe(`http://app.localhost:3000/${c.slug}/loja/pedidos/${c.pedido.id}`)
    expect(await cancelarPedido(c.slug, ESTADO_VAZIO, form({ id: c.pedido.id }))).toMatchObject({ ok: true, message: 'Pedido cancelado.' })
    expect((await prisma.order.findUniqueOrThrow({ where: { id: c.pedido.id } })).status).toBe('CANCELED')
  })
})

describe('endereços', () => {
  const dados = { recipientName: 'Maria da Silva', postalCode: '20040-020', street: 'Rua da Quitanda', number: '10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ' }

  test('salvarEndereco cria e edita só os próprios; apagarEndereco também', async () => {
    const c = await cenaComMp()
    await prepararEntrega(c)
    const criado = await salvarEndereco(c.slug, ESTADO_VAZIO, form({ ...dados, label: 'Casa' }))
    expect(criado).toMatchObject({ ok: true, message: 'Endereço salvo.' })
    const id = criado.values['id'] ?? ''
    expect(await prisma.address.findUniqueOrThrow({ where: { id } })).toMatchObject({ customerId: c.cliente.id, postalCode: '20040020', label: 'Casa', isDefault: true })
    expect((await salvarEndereco(c.slug, ESTADO_VAZIO, form({ ...dados, id, number: '99' }))).ok).toBe(true)
    expect((await prisma.address.findUniqueOrThrow({ where: { id } })).number).toBe('99')

    const alheio = await enderecoDe(c.ctxOutro)
    expect(await salvarEndereco(c.slug, ESTADO_VAZIO, form({ ...dados, id: alheio, number: '1' }))).toMatchObject({ ok: false, message: 'Endereço não encontrado.' })
    expect(await apagarEndereco(c.slug, ESTADO_VAZIO, form({ id: alheio }))).toMatchObject({ ok: false, message: 'Endereço não encontrado.' })
    expect((await prisma.address.findUniqueOrThrow({ where: { id: alheio } })).number).toBe('10')

    expect((await apagarEndereco(c.slug, ESTADO_VAZIO, form({ id }))).ok).toBe(true)
    expect(await prisma.address.count({ where: { id } })).toBe(0)
  })

  test('erro de campo volta no campo e mantém o que foi digitado', async () => {
    const c = await cenaComMp()
    const r = await salvarEndereco(c.slug, ESTADO_VAZIO, form({ ...dados, postalCode: '123', street: '' }))
    expect(r.ok).toBe(false)
    expect(r.fields['postalCode']).toBeTruthy()
    expect(r.fields['street']).toBeTruthy()
    expect(r.values['recipientName']).toBe('Maria da Silva')
    expect(await prisma.address.count()).toBe(0)
  })
})
