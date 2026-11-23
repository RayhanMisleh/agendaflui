import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { POST as pagar } from '@/app/api/v1/store/orders/[id]/checkout/route'
import { prisma } from '@/server/db/client'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago, type FakeMercadoPago } from '@/server/integrations/fakes'
import { apiError, apiRequest, callRoute, jsonObject } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeCtx } from '../../setup/factories'
import { configurarIntegracoes, produto } from '../../setup/store'
import { ctxDoCliente } from '../../setup/loyalty'
import { pedidoComRetirada } from '../../setup/store-orders'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena
let fake: FakeMercadoPago
let pedido: { id: string }

beforeEach(async () => {
  await resetDb()
  c = await montarCena()
  fake = fakeMercadoPago()
  setIntegrationsForTests({ mercadoPago: fake })
  await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { store: true } })
  await configurarIntegracoes(c.business.id, { mercadoPago: true })
  const dono = await makeCtx(c.business)
  const p = await produto(dono, { stock: 10 })
  pedido = (await pedidoComRetirada(await ctxDoCliente(c.business, c.cliente), [{ productId: p.id, quantity: 1 }])).order
  // A rota usa o relógio de verdade: o prazo do pedido de teste (criado em 17/11/2026 15:00) precisa estar à frente dele.
  await prisma.order.update({ where: { id: pedido.id }, data: { expiresAt: new Date(Date.now() + 3_600_000) } })
})

const chamar = (o: { token?: string; body?: unknown; id?: string; origin?: string } = {}) =>
  callRoute(pagar, apiRequest('POST', `/v1/store/orders/${o.id ?? pedido.id}/checkout`, { business: c.business.slug, token: o.token ?? c.tokenCliente, ...(o.body === undefined ? {} : { body: o.body }), ...(o.origin ? { origin: o.origin } : {}) }), { id: o.id ?? pedido.id })

describe('POST /v1/store/orders/{id}/checkout', () => {
  test('devolve o endereço de pagamento e o prazo; a segunda chamada devolve o mesmo', async () => {
    const r = await chamar()
    expect(r.status).toBe(200)
    const corpo = jsonObject(r.json)
    expect(Object.keys(corpo).sort()).toEqual(['checkoutUrl', 'expiresAt', 'expiresLabel'])
    expect(corpo.checkoutUrl).toMatch(/^https:\/\//)
    expect(jsonObject((await chamar()).json).checkoutUrl).toBe(corpo.checkoutUrl)
    expect(fake.preferences).toHaveLength(1)
  })

  test('sem token de cliente é 401; pedido de outro cliente é 404; Mercado Pago não configurado é 409 payment_unavailable', async () => {
    expect((await callRoute(pagar, apiRequest('POST', `/v1/store/orders/${pedido.id}/checkout`, { business: c.business.slug }), { id: pedido.id })).status).toBe(401)
    expect((await chamar({ token: c.tokenOutro })).status).toBe(404)
    await prisma.businessIntegration.deleteMany({ where: { businessId: c.business.id } })
    const r = await chamar()
    expect(r.status).toBe(409)
    expect(apiError(r.json).reason).toBe('payment_unavailable')
  })

  test('Loja desligada: 404 module_disabled antes de validar o corpo', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { store: false } })
    const r = await chamar({ body: { lixo: 1 }, id: 'nao-uuid' })
    expect(r.status).toBe(404)
    expect(apiError(r.json).code).toBe('module_disabled')
  })

  describe('returnUrl e APP_WEB_ORIGINS', () => {
    const anterior = process.env.APP_WEB_ORIGINS
    beforeEach(() => {
      process.env.APP_WEB_ORIGINS = 'https://app.exemplo.com'
    })
    afterEach(() => {
      if (anterior === undefined) delete process.env.APP_WEB_ORIGINS
      else process.env.APP_WEB_ORIGINS = anterior
    })

    test('origem do app web passa; origem de fora é 422 no campo returnUrl', async () => {
      const boa = await chamar({ body: { returnUrl: 'https://app.exemplo.com/x/pedidos/1' }, origin: 'https://app.exemplo.com' })
      expect(boa.status).toBe(200)
      expect(fake.preferences[0]!.backUrl).toBe('https://app.exemplo.com/x/pedidos/1')
      const ruim = await chamar({ body: { returnUrl: 'https://outro.exemplo.com/x/pedidos/1' } })
      expect(ruim.status).toBe(422)
      expect(apiError(ruim.json).fields?.returnUrl).toBeDefined()
      expect((await chamar({ body: { valor: 1 } })).status).toBe(422)
    })

    test('app nativo: sem returnUrl e sem Origin funciona', async () => {
      const r = await chamar()
      expect(r.status).toBe(200)
      expect(jsonObject(r.json).checkoutUrl).toMatch(/^https:\/\//)
    })
  })

  test('limite de 10 por minuto por pessoa', async () => {
    for (let i = 0; i < 10; i++) expect((await chamar()).status).toBe(200)
    const r = await chamar()
    expect(r.status).toBe(429)
  })
})
