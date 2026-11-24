import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago, type FakeMercadoPago } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness, makeCustomer } from '../setup/factories'
import { ctxDoCliente } from '../setup/loyalty'
import { configurarIntegracoes, produto } from '../setup/store'
import { estoque, marcarPago, pedidoComRetirada } from '../setup/store-orders'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { avancarEntrega, cancelarPedido, simularPagamento } from '@/app/app/painel/loja/pedidos/actions'
import PedidoPage from '@/app/app/painel/loja/pedidos/[id]/page'
import LojaPage from '@/app/app/painel/loja/page'
import { notFound } from 'next/navigation'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'
const nao = { digest: expect.stringContaining('404') }
const q = Promise.resolve({})

const form = (campos: Record<string, string>): FormData => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

/** Todos os textos que o elemento carrega (filhos e propriedades comuns), para conferir o que a tela mostra. */
function textos(no: unknown, saida: string[] = [], visto = new Set<object>()): string[] {
  if (typeof no === 'string') saida.push(no)
  else if (typeof no === 'number') saida.push(String(no))
  else if (typeof no === 'object' && no !== null && !visto.has(no)) {
    visto.add(no)
    if (Array.isArray(no)) no.forEach((n) => textos(n, saida, visto))
    else if (isValidElement(no)) {
      for (const [k, v] of Object.entries(no.props as Record<string, unknown>)) if (k !== 'ctx') textos(v as ReactNode, saida, visto)
    } else if (Object.getPrototypeOf(no) === Object.prototype) {
      for (const v of Object.values(no)) textos(v, saida, visto)
    }
  }
  return saida
}
const tela = (no: unknown) => textos(no).join(' | ')

let businessId: string
let b: { id: string }
let dono: TenantContext
let cliente: TenantContext
let fake: FakeMercadoPago
let p: { id: string }

const comoMembro = (ctx: TenantContext) =>
  guards.requireTenant.mockImplementation(async (cap?: Parameters<typeof can>[1]) => {
    if (cap && !can(ctx.actor, cap)) notFound()
    return ctx
  })

beforeEach(async () => {
  await resetDb()
  fake = fakeMercadoPago()
  setIntegrationsForTests({ mercadoPago: fake })
  const conta = await makeBusiness({ timezone: 'America/Manaus' })
  b = conta
  businessId = conta.id
  await prisma.businessModules.update({ where: { businessId }, data: { store: true } })
  await configurarIntegracoes(businessId, { mercadoPago: true })
  dono = await ctxWithRole(conta, 'OWNER')
  cliente = await ctxDoCliente(conta, await makeCustomer(businessId, { name: 'Maria da Silva' }))
  p = await produto(dono, { stock: 10, priceCents: 2500 })
  comoMembro(dono)
})
afterEach(() => {
  guards.requireTenant.mockReset()
  setIntegrationsForTests(null)
})

const pedido = async (qtd = 2, ctx = cliente) => (await pedidoComRetirada(ctx, [{ productId: p.id, quantity: qtd }])).order
const linha = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } })
const pagina = (id: string, search: Record<string, string> = {}) => PedidoPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) })

describe('permissão e isolamento', () => {
  test('profissional abrindo /loja/pedidos/<id> não tem permissão (404) e a lista também', async () => {
    const o = await pedido()
    comoMembro(await ctxWithRole(b, 'PROFESSIONAL'))
    await expect(pagina(o.id)).rejects.toMatchObject(nao)
    await expect(LojaPage({ searchParams: Promise.resolve({ aba: 'pedidos' }) })).rejects.toMatchObject(nao)
  })

  test('profissional não consegue avançar, cancelar nem simular: sem permissão e nada muda', async () => {
    const o = await pedido()
    await marcarPago(o.id)
    comoMembro(await ctxWithRole(b, 'PROFESSIONAL'))
    expect((await avancarEntrega(ini, form({ id: o.id, to: 'READY_FOR_PICKUP' }))).message).toBe(NEGADO)
    expect((await cancelarPedido(ini, form({ id: o.id }))).message).toBe(NEGADO)
    expect((await simularPagamento(ini, form({ id: o.id }))).message).toBe(NEGADO)
    expect((await linha(o.id)).fulfillmentStatus).toBe('PENDING')
    expect((await linha(o.id)).status).toBe('PAID')
  })

  test('pedido da conta B por id: 404 na página e not_found nas ações', async () => {
    const outra = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: outra.id }, data: { store: true } })
    const donoB = await ctxWithRole(outra, 'OWNER')
    const pb = await produto(donoB, { stock: 5 })
    const clienteB = await ctxDoCliente(outra, await makeCustomer(outra.id))
    const ob = (await pedidoComRetirada(clienteB, [{ productId: pb.id, quantity: 1 }])).order
    await marcarPago(ob.id)
    await expect(pagina(ob.id)).rejects.toMatchObject(nao)
    await expect(pagina('nao-uuid')).rejects.toMatchObject(nao)
    const r = await avancarEntrega(ini, form({ id: ob.id, to: 'READY_FOR_PICKUP' }))
    expect(r.ok).toBe(false)
    expect((await linha(ob.id)).fulfillmentStatus).toBe('PENDING')
    expect((await cancelarPedido(ini, form({ id: ob.id }))).ok).toBe(false)
    expect((await linha(ob.id)).status).toBe('PAID')
  })

  test('Loja desligada: páginas 404 e ações recusadas', async () => {
    const o = await pedido()
    await marcarPago(o.id)
    await prisma.businessModules.update({ where: { businessId }, data: { store: false } })
    await expect(pagina(o.id)).rejects.toMatchObject(nao)
    await expect(LojaPage({ searchParams: Promise.resolve({ aba: 'pedidos' }) })).rejects.toMatchObject(nao)
    await expect(LojaPage({ searchParams: q })).rejects.toMatchObject(nao)
    expect((await avancarEntrega(ini, form({ id: o.id, to: 'READY_FOR_PICKUP' }))).ok).toBe(false)
    expect((await cancelarPedido(ini, form({ id: o.id }))).ok).toBe(false)
    expect((await simularPagamento(ini, form({ id: o.id }))).ok).toBe(false)
    expect((await linha(o.id)).fulfillmentStatus).toBe('PENDING')
    expect((await linha(o.id)).status).toBe('PAID')
  })
})

describe('entrega', () => {
  test('gerente avança PENDING para READY_FOR_PICKUP numa retirada e a página mostra o próximo passo', async () => {
    const o = await pedido()
    await marcarPago(o.id)
    comoMembro(await ctxWithRole(b, 'MANAGER'))
    expect(tela(await pagina(o.id))).toContain('Marcar pronto para retirar')
    const r = await avancarEntrega(ini, form({ id: o.id, to: 'READY_FOR_PICKUP' }))
    expect(r.ok).toBe(true)
    expect((await linha(o.id)).fulfillmentStatus).toBe('READY_FOR_PICKUP')
    const depois = tela(await pagina(o.id))
    expect(depois).toContain('Marcar como entregue')
    expect(depois).toContain('Voltar um passo')
    expect(depois).not.toContain('Marcar pronto para retirar')
  })

  test('pular para DELIVERED num pedido de entrega ainda pendente: mensagem de transição inválida, nada muda', async () => {
    const o = await pedido()
    await marcarPago(o.id)
    await prisma.order.update({ where: { id: o.id }, data: { deliveryMethod: 'SHIPPING', shippingServiceName: 'PAC', shippingDays: 7, shippingCents: 0 } })
    const r = await avancarEntrega(ini, form({ id: o.id, to: 'DELIVERED' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe('Esta etapa não vem depois da etapa atual do pedido. Siga a ordem da entrega.')
    expect((await linha(o.id)).fulfillmentStatus).toBe('PENDING')
  })

  test('enviar com código de rastreio grava o código; voltar um passo funciona', async () => {
    const o = await pedido()
    await marcarPago(o.id)
    await prisma.order.update({ where: { id: o.id }, data: { deliveryMethod: 'SHIPPING', shippingServiceName: 'PAC', shippingDays: 7 } })
    expect((await avancarEntrega(ini, form({ id: o.id, to: 'SHIPPED', trackingCode: ' BR123456789BR ' }))).ok).toBe(true)
    expect(await linha(o.id)).toMatchObject({ fulfillmentStatus: 'SHIPPED', trackingCode: 'BR123456789BR' })
    expect(tela(await pagina(o.id))).toContain('BR123456789BR')
    expect((await avancarEntrega(ini, form({ id: o.id, to: 'PENDING' }))).ok).toBe(true)
    expect((await linha(o.id)).fulfillmentStatus).toBe('PENDING')
  })

  test('a página de pedido aguardando pagamento não oferece avançar a entrega', async () => {
    const o = await pedido()
    const t = tela(await pagina(o.id))
    expect(t).not.toContain('Marcar pronto para retirar')
    expect(t).toContain('Aguardando pagamento')
  })
})

describe('cancelar', () => {
  test('cancelar pedido pago pela tela devolve o estoque, com o texto do estorno na página', async () => {
    const o = await pedido()
    await marcarPago(o.id)
    expect(await estoque(p.id)).toBe(8)
    expect(tela(await pagina(o.id))).toContain('O estorno do pagamento é feito no painel do Mercado Pago. Cancelar aqui devolve os itens ao estoque se ainda não saíram.')
    const r = await cancelarPedido(ini, form({ id: o.id, reason: 'Cliente desistiu' }))
    expect(r.ok).toBe(true)
    expect(await linha(o.id)).toMatchObject({ status: 'CANCELED', cancelReason: 'Cliente desistiu' })
    expect(await estoque(p.id)).toBe(10)
    expect((await cancelarPedido(ini, form({ id: o.id }))).ok).toBe(false)
    expect(await estoque(p.id)).toBe(10)
  })
})

describe('simular pagamento aprovado (só no modo falso)', () => {
  test('no modo falso o pedido fica pago pelo mesmo caminho do webhook, com uma linha em payments', async () => {
    const o = await pedido()
    const r = await simularPagamento(ini, form({ id: o.id }))
    expect(r.ok).toBe(true)
    expect(await linha(o.id)).toMatchObject({ status: 'PAID' })
    const pagamentos = await prisma.payment.findMany()
    expect(pagamentos).toHaveLength(1)
    expect(pagamentos[0]).toMatchObject({ status: 'APPROVED', amountCents: o.totalCents, currency: 'BRL' })
    expect(fake.calls.map((c) => c.method)).toContain('getPayment')
    // de novo: o pedido já está pago, recusado, e nada novo é gravado
    expect((await simularPagamento(ini, form({ id: o.id }))).ok).toBe(false)
    expect(await prisma.payment.count()).toBe(1)
  })

  test('a página mostra "Simular pagamento aprovado" e o aviso "Ambiente de teste" só em pedido aguardando pagamento', async () => {
    const o = await pedido()
    const t = tela(await pagina(o.id))
    expect(t).toContain('Simular pagamento aprovado')
    expect(t).toContain('Ambiente de teste')
    await simularPagamento(ini, form({ id: o.id }))
    expect(tela(await pagina(o.id))).not.toContain('Simular pagamento aprovado')
  })

  test('Mercado Pago que não é o falso (modo real em outro lugar do código): recusado e nada muda', async () => {
    const o = await pedido()
    setIntegrationsForTests({ mercadoPago: { createPreference: fake.createPreference, getPayment: fake.getPayment, searchPaymentsByReference: fake.searchPaymentsByReference } })
    const r = await simularPagamento(ini, form({ id: o.id }))
    expect(r.ok).toBe(false)
    expect((await linha(o.id)).status).toBe('AWAITING_PAYMENT')
    expect(await prisma.payment.count()).toBe(0)
    expect(tela(await pagina(o.id))).not.toContain('Simular pagamento aprovado')
  })
})

describe('lista de pedidos', () => {
  const lista = (search: Record<string, string>) => LojaPage({ searchParams: Promise.resolve({ aba: 'pedidos', ...search }) })

  test('filtro situacao=a-entregar só traz pagos ainda não entregues', async () => {
    // Até 3 pedidos abertos por cliente: os quatro pedidos saem de dois clientes.
    const outro = await ctxDoCliente(b, await makeCustomer(businessId, { name: 'Outro Cliente' }))
    const aguardando = await pedido(1)
    const pago = await pedido(1)
    const entregue = await pedido(1, outro)
    const cancelado = await pedido(1, outro)
    await marcarPago(pago.id)
    await marcarPago(entregue.id, { fulfillment: 'DELIVERED' })
    await prisma.order.update({ where: { id: cancelado.id }, data: { status: 'CANCELED', canceledAt: new Date() } })
    const numeros = (r: unknown) => [aguardando, pago, entregue, cancelado].filter((o) => tela(r).includes(`#${o.number}`)).map((o) => o.number)
    expect(numeros(await lista({ situacao: 'a-entregar' }))).toEqual([pago.number])
    expect(numeros(await lista({ situacao: 'aguardando' }))).toEqual([aguardando.number])
    expect(numeros(await lista({ situacao: 'entregues' }))).toEqual([entregue.number])
    expect(numeros(await lista({ situacao: 'cancelados' }))).toEqual([cancelado.number])
    expect(numeros(await lista({}))).toEqual([aguardando.number, pago.number, entregue.number, cancelado.number])
  })

  test('busca por número ou nome do cliente, e lixo na URL não quebra a página', async () => {
    const o = await pedido(1)
    const outro = (await pedidoComRetirada(await ctxDoCliente(b, await makeCustomer(businessId, { name: 'João Souza' })), [{ productId: p.id, quantity: 1 }])).order
    expect(tela(await lista({ search: String(o.number) }))).toContain(`#${o.number}`)
    expect(tela(await lista({ search: String(o.number) }))).not.toContain(`#${outro.number}`)
    expect(tela(await lista({ search: 'joao' }))).toContain(`#${outro.number}`)
    expect(tela(await lista({ search: 'joao' }))).not.toContain(`#${o.number}`)
    const lixo: Record<string, string>[] = [{ situacao: 'lixo' }, { cursor: 'lixo' }, { search: '\u0000' }, { situacao: '%00' }]
    for (const s of lixo) await expect(lista(s)).resolves.toBeTruthy()
  })

  test('mostra o selo de atenção em texto e a explicação na página do pedido', async () => {
    const o = await pedido(1)
    await prisma.order.update({ where: { id: o.id }, data: { attention: 'amount_mismatch' } })
    expect(tela(await lista({}))).toContain('Valor divergente')
    const t = tela(await pagina(o.id))
    expect(t).toContain('Valor divergente')
    expect(t).toMatch(/pagamento.*valor.*diferente|valor pago/i)
    for (const [attention, texto] of [['stock_shortfall', 'Pago sem estoque'], ['payment_reversed', 'Pagamento devolvido']] as const) {
      await prisma.order.update({ where: { id: o.id }, data: { attention } })
      expect(tela(await lista({}))).toContain(texto)
    }
  })

  test('pedidos de outra conta não aparecem', async () => {
    const outra = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: outra.id }, data: { store: true } })
    const pb = await produto(await ctxWithRole(outra, 'OWNER'), { stock: 5 })
    const ob = (await pedidoComRetirada(await ctxDoCliente(outra, await makeCustomer(outra.id, { name: 'Cliente de B' })), [{ productId: pb.id, quantity: 1 }])).order
    await pedido(1)
    const t = tela(await lista({}))
    expect(t).not.toContain('Cliente de B')
    expect(ob.number).toBe(1001)
  })
})

describe('página do pedido', () => {
  test('mostra itens com o preço da compra, totais, cliente com link para a ficha, pagamentos e linha do tempo', async () => {
    const o = await pedido(2)
    await simularPagamento(ini, form({ id: o.id }))
    const t = tela(await pagina(o.id))
    expect(t).toContain(`#${o.number}`)
    expect(t).toContain('Shampoo')
    expect(t).toContain('Maria da Silva')
    expect(t).toMatch(/\/painel\/clientes\/[0-9a-f-]{36}/)
    expect(t).toContain('Aprovado')
    expect(t).toContain('Pedido criado')
    expect(t).toContain('Pago em')
    const pagamento = await prisma.payment.findFirstOrThrow()
    expect(t).toContain(pagamento.providerPaymentId)
  })
})
