import { beforeEach, describe, expect, test, vi } from 'vitest'
import { POST as cancelar } from '@/app/api/v1/store/orders/[id]/cancel/route'
import { GET as umPedido } from '@/app/api/v1/store/orders/[id]/route'
import { GET as listar, POST as criar } from '@/app/api/v1/store/orders/route'
import { POST as cotar } from '@/app/api/v1/store/shipping-quotes/route'
import { prisma } from '@/server/db/client'
import { createAddress } from '@/server/domain/store/addresses'
import { updateStoreSettings } from '@/server/domain/store/settings'
import { setIntegrationsForTests } from '@/server/integrations'
import { IntegrationError } from '@/server/integrations/errors'
import { apiError, apiRequest, callRoute, jsonObject } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeCtx } from '../../setup/factories'
import { configurarIntegracoes, produto } from '../../setup/store'
import { ctxDoCliente } from '../../setup/loyalty'
import { ENDERECO } from '../../setup/store-orders'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena
let dono: Awaited<ReturnType<typeof makeCtx>>

beforeEach(async () => {
  await resetDb()
  setIntegrationsForTests(null)
  c = await montarCena()
  await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { store: true } })
  dono = await makeCtx(c.business)
})

const get = (h: Parameters<typeof callRoute>[0], path: string, o: { token?: string; params?: Record<string, string> } = {}) =>
  callRoute(h, apiRequest('GET', path, { key: c.key, ...(o.token ? { token: o.token } : {}) }), o.params ?? {})
let chaves = 0
// O pedido exige `Idempotency-Key`: o `post` manda uma chave nova a cada chamada, salvo `semChave` ou `headers` próprios.
const post = (h: Parameters<typeof callRoute>[0], path: string, body: unknown, o: { token?: string; headers?: Record<string, string>; params?: Record<string, string>; semChave?: boolean } = {}) =>
  callRoute(h, apiRequest('POST', path, { key: c.key, ...(o.token ? { token: o.token } : {}), ...(body === undefined ? {} : { body }), headers: { ...(o.semChave ? {} : { 'idempotency-key': `chave-${++chaves}` }), ...(o.headers ?? {}) } }), o.params ?? {})

const CONFIG = { pickupEnabled: true, pickupInstructions: 'Na recepção', shippingEnabled: true, originPostalCode: '01310100', defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 }, paymentWindowMin: 60 }

async function cenaEntrega() {
  await configurarIntegracoes(c.business.id, { frenet: true })
  await updateStoreSettings(dono, 0, CONFIG)
  const p = await produto(dono, { name: 'Pomada', priceCents: 2500, stock: 10 })
  const ctxCliente = await ctxDoCliente(c.business, c.cliente)
  const addr = await createAddress(ctxCliente, ENDERECO)
  return { p, addr, lines: [{ productId: p.id, quantity: 2 }] }
}

describe('módulo desligado', () => {
  test('todas as rotas respondem 404 module_disabled, antes de validar corpo e parâmetros', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { store: false } })
    const t = c.tokenCliente
    const respostas = [
      await post(cotar, '/v1/store/shipping-quotes', { lixo: 1 }, { token: t }),
      await post(criar, '/v1/store/orders', { lixo: 1 }, { token: t }),
      await get(listar, '/v1/store/orders?limit=999', { token: t }),
      await get(umPedido, '/v1/store/orders/x', { token: t, params: { id: 'nao-uuid' } }),
      await post(cancelar, '/v1/store/orders/x/cancel', undefined, { token: t, params: { id: 'nao-uuid' } }),
    ]
    for (const r of respostas) {
      expect(r.status).toBe(404)
      expect(apiError(r.json).code).toBe('module_disabled')
    }
  })
})

describe('POST /v1/store/shipping-quotes', () => {
  test('devolve a retirada e as opções com quoteToken', async () => {
    const { addr, lines } = await cenaEntrega()
    const r = await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines }, { token: c.tokenCliente })
    expect(r.status).toBe(200)
    const corpo = jsonObject(r.json)
    expect(corpo.pickup).toEqual({ available: true, instructions: 'Na recepção' })
    expect(corpo.shippingError).toBeNull()
    const opcoes = corpo.options as Record<string, unknown>[]
    expect(opcoes.map((o) => [o.serviceCode, o.priceCents, o.days])).toEqual([['PAC', 2150, 7], ['SEDEX', 3890, 3]])
    expect(Object.keys(opcoes[0] ?? {}).sort()).toEqual(['carrier', 'days', 'name', 'priceCents', 'quoteToken', 'serviceCode'])
    expect(typeof opcoes[0]?.quoteToken).toBe('string')
  })

  test('Frenet fora do ar: 200 com o erro em texto, nunca erro HTTP', async () => {
    const { addr, lines } = await cenaEntrega()
    setIntegrationsForTests({ frenet: { quote: async () => { throw new IntegrationError('timeout', 'x') } } })
    const r = await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines }, { token: c.tokenCliente })
    expect(r.status).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ options: [], shippingError: 'A entrega não está disponível agora. Você pode retirar no local.', pickup: { available: true } })
  })

  test('exige login de cliente; endereço de outro cliente é 404; corpo com campo desconhecido é 422', async () => {
    const { addr, lines } = await cenaEntrega()
    expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines })).status).toBe(401)
    expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines }, { token: c.tokenOutro })).status).toBe(404)
    expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines, priceCents: 1 }, { token: c.tokenCliente })).status).toBe(422)
    expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines: [{ productId: lines[0]?.productId, quantity: 1, priceCents: 1 }] }, { token: c.tokenCliente })).status).toBe(422)
    expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines: [] }, { token: c.tokenCliente })).status).toBe(422)
  })

  test('o limite é de 20 por minuto por pessoa', async () => {
    const { addr, lines } = await cenaEntrega()
    for (let i = 0; i < 20; i++) expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines }, { token: c.tokenCliente })).status).toBe(200)
    expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines }, { token: c.tokenCliente })).status).toBe(429)
    expect((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines }, { token: c.tokenOutro })).status).toBe(404)
  })
})

describe('POST /v1/store/orders', () => {
  test('retirada: 201 na primeira, 200 na repetição com a mesma Idempotency-Key, e uma reserva só', async () => {
    const { p, lines } = await cenaEntrega()
    const h = { 'idempotency-key': 'abc-123' }
    const corpo = { lines, delivery: { method: 'PICKUP' }, note: 'Passo à tarde' }
    const a = await post(criar, '/v1/store/orders', corpo, { token: c.tokenCliente, headers: h })
    expect(a.status).toBe(201)
    expect(jsonObject(a.json)).toMatchObject({ number: 1001, status: 'AWAITING_PAYMENT', deliveryMethod: 'PICKUP', itemsCents: 5000, shippingCents: 0, totalCents: 5000, customerNote: 'Passo à tarde', canCancel: true, canPay: true, pickupInstructions: 'Na recepção' })
    const b = await post(criar, '/v1/store/orders', corpo, { token: c.tokenCliente, headers: h })
    expect(b.status).toBe(200)
    expect(jsonObject(b.json).id).toBe(jsonObject(a.json).id)
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(8)
    expect(await prisma.order.count()).toBe(1)
  })

  test('a resposta não carrega dado interno: sem attention, sem cliente, sem ids de conta', async () => {
    const { lines } = await cenaEntrega()
    const r = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })
    expect(r.status).toBe(201)
    expect(Object.keys(jsonObject(r.json)).sort()).toEqual([
      'address', 'canCancel', 'canPay', 'cancelReason', 'canceledLabel', 'createdLabel', 'customerNote', 'deliveryMethod', 'expiresAt', 'expiresLabel', 'fulfillmentStatus', 'id', 'items', 'itemsCents', 'number', 'paidLabel', 'pickupInstructions', 'shipping', 'shippingCents', 'status', 'totalCents',
    ])
    expect(r.text).not.toContain(c.business.id)
    expect(r.text).not.toContain(c.cliente.id)
  })

  test('entrega com a cotação: total = itens + frete do token', async () => {
    const { addr, lines } = await cenaEntrega()
    const q = jsonObject((await post(cotar, '/v1/store/shipping-quotes', { addressId: addr.id, lines }, { token: c.tokenCliente })).json)
    const sedex = (q.options as { serviceCode: string; quoteToken: string }[]).find((o) => o.serviceCode === 'SEDEX')
    const r = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'SHIPPING', addressId: addr.id, quoteToken: sedex?.quoteToken } }, { token: c.tokenCliente })
    expect(r.status).toBe(201)
    expect(jsonObject(r.json)).toMatchObject({ deliveryMethod: 'SHIPPING', itemsCents: 5000, shippingCents: 3890, totalCents: 8890, shipping: { serviceName: 'SEDEX', days: 3, trackingCode: null }, address: { postalCode: '20040020', city: 'Rio de Janeiro' } })
  })

  test('corpo com priceCents, totalCents ou shippingCents (no pedido ou nas linhas) é 422 e nada é criado', async () => {
    const { p, lines } = await cenaEntrega()
    const ruins = [
      { lines, delivery: { method: 'PICKUP' }, totalCents: 1 },
      { lines, delivery: { method: 'PICKUP' }, shippingCents: 0 },
      { lines, delivery: { method: 'PICKUP' }, priceCents: 1 },
      { lines: [{ productId: p.id, quantity: 1, priceCents: 1 }], delivery: { method: 'PICKUP' } },
      { lines: [{ productId: p.id, quantity: 1, unitPriceCents: 1 }], delivery: { method: 'PICKUP' } },
      { lines, delivery: { method: 'PICKUP', shippingCents: 0 } },
      { lines, delivery: { method: 'SHIPPING', addressId: c.cliente.id, quoteToken: 'x', priceCents: 0 } },
    ]
    for (const corpo of ruins) {
      const r = await post(criar, '/v1/store/orders', corpo, { token: c.tokenCliente })
      expect(r.status, JSON.stringify(corpo)).toBe(422)
      expect(apiError(r.json).code).toBe('validation')
    }
    const r = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' }, totalCents: 1 }, { token: c.tokenCliente })
    expect(Object.keys(apiError(r.json).fields ?? {})).toEqual(['totalCents'])
    expect(await prisma.order.count()).toBe(0)
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10)
  })

  test('forma de entrega inválida ou incompleta é 422; quoteToken ruim é 422 invalid_quote', async () => {
    const { addr, lines } = await cenaEntrega()
    for (const delivery of [undefined, {}, { method: 'CORREIO' }, { method: 'SHIPPING' }, { method: 'SHIPPING', addressId: addr.id }, { method: 'SHIPPING', quoteToken: 'x' }]) {
      expect((await post(criar, '/v1/store/orders', { lines, ...(delivery === undefined ? {} : { delivery }) }, { token: c.tokenCliente })).status, JSON.stringify(delivery)).toBe(422)
    }
    const r = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'SHIPPING', addressId: addr.id, quoteToken: 'lixo' } }, { token: c.tokenCliente })
    expect(r.status).toBe(422)
    expect(apiError(r.json).reason).toBe('invalid_quote')
  })

  test('estoque insuficiente: 409 out_of_stock com o nome do produto', async () => {
    const { p } = await cenaEntrega()
    const r = await post(criar, '/v1/store/orders', { lines: [{ productId: p.id, quantity: 11 }], delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })
    expect(r.status).toBe(409)
    expect(apiError(r.json)).toMatchObject({ code: 'conflict', reason: 'out_of_stock' })
    expect(apiError(r.json).message).toContain('Pomada')
  })

  test('mesma chave com outro pedido é 409 idempotency_key_reused; chave malformada é 422', async () => {
    const { p, lines } = await cenaEntrega()
    const h = { 'idempotency-key': 'k1' }
    await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente, headers: h })
    const outra = await post(criar, '/v1/store/orders', { lines: [{ productId: p.id, quantity: 3 }], delivery: { method: 'PICKUP' } }, { token: c.tokenCliente, headers: h })
    expect(outra.status).toBe(409)
    expect(apiError(outra.json).reason).toBe('idempotency_key_reused')
    const ruim = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente, headers: { 'idempotency-key': 'chave ruim!' } })
    expect(ruim.status).toBe(422)
  })

  test('exige login de cliente (visitante e equipe não fazem pedido) e o limite é de 10 por minuto por pessoa', async () => {
    const { p, lines } = await cenaEntrega()
    await prisma.product.update({ where: { id: p.id }, data: { stock: 100 } })
    expect((await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } })).status).toBe(401)
    // Até 3 pedidos aguardando pagamento por cliente: do 4º em diante é 409, mas cada tentativa conta no limite da rota.
    const respostas: number[] = []
    for (let i = 0; i < 10; i++) respostas.push((await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })).status)
    expect(respostas).toEqual([201, 201, 201, 409, 409, 409, 409, 409, 409, 409])
    expect((await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })).status).toBe(429)
  })

  test('o 4º pedido aguardando pagamento é 409 too_many_open_orders com a mensagem em português', async () => {
    const { lines } = await cenaEntrega()
    for (let i = 0; i < 3; i++) expect((await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })).status).toBe(201)
    const r = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })
    expect(r.status).toBe(409)
    expect(apiError(r.json)).toMatchObject({ code: 'conflict', reason: 'too_many_open_orders', message: 'Você já tem pedidos esperando pagamento. Pague ou cancele um deles.' })
  })

  test('sem Idempotency-Key o pedido é 422 e nada é reservado; com a chave passa', async () => {
    const { p, lines } = await cenaEntrega()
    const r = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente, semChave: true })
    expect(r.status).toBe(422)
    expect(apiError(r.json).code).toBe('validation')
    expect(Object.keys(apiError(r.json).fields ?? {})).toEqual(['Idempotency-Key'])
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10)
    expect(await prisma.order.count()).toBe(0)
    const vazia = await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente, semChave: true, headers: { 'idempotency-key': '' } })
    expect(vazia.status).toBe(422)
    expect((await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })).status).toBe(201)
  })
})

describe('leitura e cancelamento pela API', () => {
  async function dois() {
    const { lines } = await cenaEntrega()
    const meu = jsonObject((await post(criar, '/v1/store/orders', { lines, delivery: { method: 'PICKUP' } }, { token: c.tokenCliente })).json)
    const dele = jsonObject((await post(criar, '/v1/store/orders', { lines: [{ productId: lines[0]?.productId, quantity: 1 }], delivery: { method: 'PICKUP' } }, { token: c.tokenOutro })).json)
    return { meu, dele }
  }

  test('GET lista só os pedidos do cliente, com cursor e filtro por situação; GET por id só o próprio', async () => {
    const { meu, dele } = await dois()
    const lista = jsonObject((await get(listar, '/v1/store/orders?limit=1', { token: c.tokenCliente })).json)
    expect((lista.items as { id: string }[]).map((o) => o.id)).toEqual([meu.id])
    expect(lista.nextCursor).toBeNull()
    expect(jsonObject((await get(listar, '/v1/store/orders?status=PAID', { token: c.tokenCliente })).json).items).toEqual([])
    expect((await get(listar, '/v1/store/orders?status=EXPLODIU', { token: c.tokenCliente })).status).toBe(422)
    expect(jsonObject((await get(umPedido, `/v1/store/orders/${meu.id}`, { token: c.tokenCliente, params: { id: meu.id as string } })).json).id).toBe(meu.id)
    const alheio = await get(umPedido, `/v1/store/orders/${dele.id}`, { token: c.tokenCliente, params: { id: dele.id as string } })
    expect(alheio.status).toBe(404)
    expect(apiError(alheio.json).code).toBe('not_found')
    expect((await get(listar, '/v1/store/orders')).status).toBe(401)
  })

  test('pedido de outra conta é 404 mesmo com a chave desta', async () => {
    const { meu } = await dois()
    const outra = await montarCena()
    await prisma.businessModules.update({ where: { businessId: outra.business.id }, data: { store: true } })
    const r = await callRoute(umPedido, apiRequest('GET', `/v1/store/orders/${meu.id}`, { key: outra.key, token: outra.tokenCliente }), { id: meu.id as string })
    expect(r.status).toBe(404)
  })

  test('cancelar: o cliente cancela o próprio pedido aguardando pagamento (o estoque volta); de novo é 409 invalid_transition', async () => {
    const { meu, dele } = await dois()
    const r = await post(cancelar, `/v1/store/orders/${meu.id}/cancel`, { reason: 'Desisti' }, { token: c.tokenCliente, params: { id: meu.id as string } })
    expect(r.status).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ status: 'CANCELED', cancelReason: 'Desisti', canCancel: false })
    const de_novo = await post(cancelar, `/v1/store/orders/${meu.id}/cancel`, undefined, { token: c.tokenCliente, params: { id: meu.id as string } })
    expect(de_novo.status).toBe(409)
    expect(apiError(de_novo.json).reason).toBe('invalid_transition')
    expect((await prisma.product.findFirstOrThrow({ where: { businessId: c.business.id } })).stock).toBe(9)
    const outro = await post(cancelar, `/v1/store/orders/${dele.id}/cancel`, undefined, { token: c.tokenCliente, params: { id: dele.id as string } })
    expect(outro.status).toBe(404)
  })

  test('cancelar sem corpo vale; campo desconhecido no corpo é 422', async () => {
    const { meu } = await dois()
    expect((await post(cancelar, `/v1/store/orders/${meu.id}/cancel`, { foo: 1 }, { token: c.tokenCliente, params: { id: meu.id as string } })).status).toBe(422)
    expect((await post(cancelar, `/v1/store/orders/${meu.id}/cancel`, undefined, { token: c.tokenCliente, params: { id: meu.id as string } })).status).toBe(200)
  })
})
