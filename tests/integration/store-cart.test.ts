import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { archiveCategory, createCategory } from '@/server/domain/store/categories'
import { priceCart } from '@/server/domain/store/cart'
import { archiveProduct } from '@/server/domain/store/products'
import { quoteShipping } from '@/server/domain/store/shipping'
import { readQuote, quoteExpired } from '@/server/domain/store/quote-token'
import { updateStoreSettings } from '@/server/domain/store/settings'
import { setIntegrationsForTests, type Integrations } from '@/server/integrations'
import { IntegrationError } from '@/server/integrations/errors'
import { createGuestContext } from '@/server/auth/guest-context'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { cenaLoja, configurarIntegracoes, ligarEntrega, produto, type CenaLoja } from '../setup/store'
import { enderecoDe, prepararEntrega } from '../setup/store-orders'

beforeEach(resetDb)

let c: CenaLoja
beforeEach(async () => {
  setIntegrationsForTests(null)
  c = await cenaLoja()
})

const camposDe = (e: { fields?: Record<string, string> }) => Object.keys(e.fields ?? {})

describe('priceCart', () => {
  test('o preço vem do banco (promoção vale), com total por linha, total dos itens e medidas', async () => {
    const a = await produto(c.dono, { name: 'Pomada', priceCents: 3000, promoPriceCents: 2500, weightGrams: 300, lengthCm: 10, heightCm: 5, widthCm: 8 })
    const b = await produto(c.dono, { name: 'Gel', priceCents: 1000 })
    const cart = await priceCart(c.ctxCliente, [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 3 }])
    expect(cart.itemsCents).toBe(2 * 2500 + 3 * 1000)
    expect(cart.physical).toBe(true)
    expect(cart.lines).toHaveLength(2)
    expect(cart.lines[0]).toEqual({ kind: 'product', id: a.id, name: 'Pomada', unitPriceCents: 2500, quantity: 2, totalCents: 5000, weightGrams: 300, lengthCm: 10, heightCm: 5, widthCm: 8 })
    // O produto sem medidas usa o pacote padrão da loja (1000 g, 20 x 10 x 30).
    expect(cart.lines[1]).toMatchObject({ id: b.id, weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 })
  })

  test('o pacote padrão configurado vale para o produto sem medidas', async () => {
    const p = await produto(c.dono, { weightGrams: 250 })
    await updateStoreSettings(c.dono, 0, { pickupEnabled: true, pickupInstructions: null, shippingEnabled: false, originPostalCode: null, defaultPackage: { weightGrams: 800, lengthCm: 40, heightCm: 15, widthCm: 25 }, paymentWindowMin: 60 })
    expect((await priceCart(c.ctxCliente, [{ productId: p.id, quantity: 1 }])).lines[0]).toMatchObject({ weightGrams: 250, lengthCm: 40, heightCm: 15, widthCm: 25 })
  })

  test('o hash é o SHA-256 de "id:quantidade" das linhas por id, e não depende da ordem das linhas', async () => {
    const a = await produto(c.dono, { name: 'A' })
    const b = await produto(c.dono, { name: 'B' })
    const [primeiro, segundo] = [a.id, b.id].sort() as [string, string]
    const x = await priceCart(c.ctxCliente, [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 1 }])
    const y = await priceCart(c.ctxCliente, [{ productId: b.id, quantity: 1 }, { productId: a.id, quantity: 2 }])
    expect(x.hash).toBe(y.hash)
    const q = (id: string) => (id === a.id ? 2 : 1)
    expect(x.hash).toBe(createHash('sha256').update(`${primeiro}:${q(primeiro)},${segundo}:${q(segundo)}`).digest('hex'))
    const z = await priceCart(c.ctxCliente, [{ productId: a.id, quantity: 3 }, { productId: b.id, quantity: 1 }])
    expect(z.hash).not.toBe(x.hash)
    const w = await priceCart(c.ctxCliente, [{ productId: a.id, quantity: 2 }])
    expect(w.hash).not.toBe(x.hash)
  })

  test('mudar o preço no banco muda o total (nada fica guardado do carrinho antigo)', async () => {
    const p = await produto(c.dono, { priceCents: 1000 })
    expect((await priceCart(c.ctxCliente, [{ productId: p.id, quantity: 2 }])).itemsCents).toBe(2000)
    await prisma.product.update({ where: { id: p.id }, data: { priceCents: 1500 } })
    expect((await priceCart(c.ctxCliente, [{ productId: p.id, quantity: 2 }])).itemsCents).toBe(3000)
  })

  test('de 1 a 20 linhas, sem produto repetido, quantidade de 1 a 99 inteira', async () => {
    const p = await produto(c.dono)
    const q = await produto(c.dono, { name: 'Outro' })
    expect(camposDe(await domainError(priceCart(c.ctxCliente, [])))).toContain('lines')
    const vinte = await Promise.all(Array.from({ length: 21 }, (_, i) => produto(c.dono, { name: `P${i}` })))
    expect(camposDe(await domainError(priceCart(c.ctxCliente, vinte.map((x) => ({ productId: x.id, quantity: 1 })))))).toContain('lines')
    expect((await priceCart(c.ctxCliente, vinte.slice(0, 20).map((x) => ({ productId: x.id, quantity: 1 })))).lines).toHaveLength(20)
    const repetido = await domainError(priceCart(c.ctxCliente, [{ productId: p.id, quantity: 1 }, { productId: p.id, quantity: 2 }]))
    expect(repetido.code).toBe('validation')
    expect(camposDe(repetido)).toEqual(['lines.1.productId'])
    for (const quantity of [0, -1, 100, 1.5, Number.NaN]) {
      const e = await domainError(priceCart(c.ctxCliente, [{ productId: p.id, quantity }, { productId: q.id, quantity: 1 }]))
      expect(camposDe(e), String(quantity)).toEqual(['lines.0.quantity'])
    }
    expect((await priceCart(c.ctxCliente, [{ productId: p.id, quantity: 99 }])).lines[0]?.quantity).toBe(99)
    expect(camposDe(await domainError(priceCart(c.ctxCliente, [{ productId: 'nao-uuid', quantity: 1 }])))).toEqual(['lines.0.productId'])
  })

  test('produto inativo, arquivado, de categoria arquivada ou de outra conta não entra no carrinho', async () => {
    const cat = await createCategory(c.dono, { name: 'Cabelo' })
    const inativo = await produto(c.dono, { active: false })
    const arquivado = await produto(c.dono)
    await archiveProduct(c.dono, arquivado.id)
    const daCategoria = await produto(c.dono, { categoryId: cat.id })
    await archiveCategory(c.dono, cat.id)
    const outra = await cenaLoja()
    const alheio = await produto(outra.dono)
    for (const p of [inativo, arquivado, daCategoria, alheio]) {
      const e = await domainError(priceCart(c.ctxCliente, [{ productId: p.id, quantity: 1 }]))
      expect(e.code).toBe('validation')
      expect(camposDe(e)).toEqual(['lines.0.productId'])
    }
  })

  test('valor alto demais é recusado em vez de estourar o inteiro do banco', async () => {
    const caro = await produto(c.dono, { priceCents: 100_000_000 })
    const e = await domainError(priceCart(c.ctxCliente, [{ productId: caro.id, quantity: 99 }]))
    expect(e.code).toBe('validation')
  })
})

describe('quoteShipping', () => {
  test('com tudo configurado devolve PAC e SEDEX com token assinado de 30 minutos, e a retirada', async () => {
    await prepararEntrega(c)
    await updateStoreSettings(c.dono, 1, { pickupEnabled: true, pickupInstructions: 'Na recepção', shippingEnabled: true, originPostalCode: '01310100', defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 }, paymentWindowMin: 60 })
    const p = await produto(c.dono, { priceCents: 2500 })
    const addressId = await enderecoDe(c.ctxCliente)
    const lines = [{ productId: p.id, quantity: 2 }]
    const q = await quoteShipping(c.ctxCliente, { addressId, lines })
    expect(q.pickup).toEqual({ available: true, instructions: 'Na recepção' })
    expect(q.shippingError).toBeNull()
    expect(q.options.map((o) => [o.serviceCode, o.name, o.carrier, o.priceCents, o.days])).toEqual([
      ['PAC', 'PAC', 'Correios', 2150, 7],
      ['SEDEX', 'SEDEX', 'Correios', 3890, 3],
    ])
    const cart = await priceCart(c.ctxCliente, lines)
    for (const o of q.options) {
      const payload = readQuote(o.quoteToken)
      expect(payload).toEqual({
        businessId: c.b.id,
        customerId: c.cliente.id,
        addressId,
        postalCode: '20040020',
        cartHash: cart.hash,
        serviceCode: o.serviceCode,
        serviceName: o.name,
        priceCents: o.priceCents,
        days: o.days,
        expiresAtMs: c.now.getTime() + 30 * 60_000,
      })
      expect(quoteExpired(payload!, c.now)).toBe(false)
    }
  })

  test('a Frenet recebe o CEP de origem, o CEP do endereço, o valor dos itens e as medidas de cada produto', async () => {
    await prepararEntrega(c)
    const quote = vi.fn<Integrations['frenet']['quote']>(async () => [{ serviceCode: 'PAC', name: 'PAC', carrier: 'Correios', priceCents: 1000, days: 5 }])
    setIntegrationsForTests({ frenet: { quote } })
    const a = await produto(c.dono, { priceCents: 3000, promoPriceCents: 2000, weightGrams: 400, lengthCm: 11, heightCm: 6, widthCm: 9 })
    const b = await produto(c.dono, { priceCents: 1000 })
    const addressId = await enderecoDe(c.ctxCliente)
    await quoteShipping(c.ctxCliente, { addressId, lines: [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 1 }] })
    expect(quote).toHaveBeenCalledTimes(1)
    const [token, q] = quote.mock.calls[0]!
    expect(token).toBe('FRENET-TOKEN-0123456789-Vb6D')
    expect(q).toEqual({
      sellerCep: '01310100',
      recipientCep: '20040020',
      invoiceValueCents: 2 * 2000 + 1000,
      items: [
        { sku: a.id, quantity: 2, weightKg: 0.4, lengthCm: 11, heightCm: 6, widthCm: 9 },
        { sku: b.id, quantity: 1, weightKg: 1, lengthCm: 20, heightCm: 10, widthCm: 30 },
      ],
    })
  })

  test('com a Frenet falhando (qualquer tipo de erro) devolve o erro em texto e a retirada continua disponível', async () => {
    await prepararEntrega(c)
    const p = await produto(c.dono)
    const addressId = await enderecoDe(c.ctxCliente)
    for (const code of ['timeout', 'unavailable', 'rejected', 'invalid_response'] as const) {
      setIntegrationsForTests({ frenet: { quote: async () => { throw new IntegrationError(code, 'falhou') } } })
      const q = await quoteShipping(c.ctxCliente, { addressId, lines: [{ productId: p.id, quantity: 1 }] })
      expect(q.options, code).toEqual([])
      expect(q.shippingError, code).toBe('A entrega não está disponível agora. Você pode retirar no local.')
      expect(q.pickup.available).toBe(true)
    }
  })

  test('lista vazia da Frenet: sem opções e com o erro em texto', async () => {
    await prepararEntrega(c)
    setIntegrationsForTests({ frenet: { quote: async () => [] } })
    const p = await produto(c.dono)
    const q = await quoteShipping(c.ctxCliente, { addressId: await enderecoDe(c.ctxCliente), lines: [{ productId: p.id, quantity: 1 }] })
    expect(q.options).toEqual([])
    expect(q.shippingError).toBe('A entrega não está disponível agora. Você pode retirar no local.')
  })

  test('um erro que não é de integração não vira "frete indisponível"', async () => {
    await prepararEntrega(c)
    setIntegrationsForTests({ frenet: { quote: async () => { throw new TypeError('bug') } } })
    const p = await produto(c.dono)
    await expect(quoteShipping(c.ctxCliente, { addressId: await enderecoDe(c.ctxCliente), lines: [{ productId: p.id, quantity: 1 }] })).rejects.toThrow('bug')
  })

  test('entrega desligada, sem CEP de origem ou sem token da Frenet: erro em texto e a Frenet nem é chamada', async () => {
    const quote = vi.fn<Integrations['frenet']['quote']>(async () => [])
    setIntegrationsForTests({ frenet: { quote } })
    const p = await produto(c.dono)
    const addressId = await enderecoDe(c.ctxCliente)
    const lines = [{ productId: p.id, quantity: 1 }]
    // Entrega desligada (o padrão).
    expect((await quoteShipping(c.ctxCliente, { addressId, lines })).shippingError).toBe('A entrega não está disponível agora. Você pode retirar no local.')
    // Ligada, mas sem o token da Frenet.
    await ligarEntrega(c.b.id)
    const semToken = await quoteShipping(c.ctxCliente, { addressId, lines })
    expect(semToken.options).toEqual([])
    expect(semToken.shippingError).toBe('A entrega não está disponível agora. Você pode retirar no local.')
    // Token configurado, mas sem CEP de origem (linha apagada à mão).
    await configurarIntegracoes(c.b.id, { frenet: true })
    await prisma.$executeRaw`update store_settings set origin_postal_code = null, shipping_enabled = true where business_id = ${c.b.id}::uuid`
    expect((await quoteShipping(c.ctxCliente, { addressId, lines })).options).toEqual([])
    expect(quote).not.toHaveBeenCalled()
  })

  test('sem retirada, o erro não manda retirar no local', async () => {
    await prepararEntrega(c)
    await updateStoreSettings(c.dono, 1, { pickupEnabled: false, pickupInstructions: null, shippingEnabled: true, originPostalCode: '01310100', defaultPackage: { weightGrams: 1000, lengthCm: 20, heightCm: 10, widthCm: 30 }, paymentWindowMin: 60 })
    setIntegrationsForTests({ frenet: { quote: async () => { throw new IntegrationError('timeout', 'x') } } })
    const p = await produto(c.dono)
    const q = await quoteShipping(c.ctxCliente, { addressId: await enderecoDe(c.ctxCliente), lines: [{ productId: p.id, quantity: 1 }] })
    expect(q.pickup.available).toBe(false)
    expect(q.shippingError).toBe('A entrega não está disponível agora. Tente de novo em instantes.')
  })

  test('endereço de outro cliente ou de outra conta é not_found, e a Frenet não é chamada', async () => {
    await prepararEntrega(c)
    const quote = vi.fn<Integrations['frenet']['quote']>(async () => [])
    setIntegrationsForTests({ frenet: { quote } })
    const p = await produto(c.dono)
    const lines = [{ productId: p.id, quantity: 1 }]
    const doOutro = await enderecoDe(c.ctxOutro)
    expect((await domainError(quoteShipping(c.ctxCliente, { addressId: doOutro, lines }))).code).toBe('not_found')
    const b2 = await cenaLoja()
    const alheio = await enderecoDe(b2.ctxCliente)
    expect((await domainError(quoteShipping(c.ctxCliente, { addressId: alheio, lines }))).code).toBe('not_found')
    expect((await domainError(quoteShipping(c.ctxCliente, { addressId: 'nao-uuid', lines }))).code).toBe('not_found')
    expect(quote).not.toHaveBeenCalled()
  })

  test('só o cliente do app cota; carrinho ruim é validation; módulo desligado recusa', async () => {
    await prepararEntrega(c)
    const p = await produto(c.dono)
    const addressId = await enderecoDe(c.ctxCliente)
    const visitante = await createGuestContext({ businessId: c.b.id, timeZone: 'America/Manaus', request: { ip: null, userAgent: null } })
    expect((await domainError(quoteShipping(visitante, { addressId, lines: [{ productId: p.id, quantity: 1 }] }))).code).toBe('forbidden')
    expect((await domainError(quoteShipping(c.dono, { addressId, lines: [{ productId: p.id, quantity: 1 }] }))).code).toBe('forbidden')
    expect((await domainError(quoteShipping(c.ctxCliente, { addressId, lines: [] }))).code).toBe('validation')
    await prisma.businessModules.update({ where: { businessId: c.b.id }, data: { store: false } })
    expect((await domainError(quoteShipping(c.ctxCliente, { addressId, lines: [{ productId: p.id, quantity: 1 }] }))).code).toBe('module_disabled')
  })

  test('as opções saem do mais barato para o mais caro', async () => {
    await prepararEntrega(c)
    setIntegrationsForTests({
      frenet: {
        quote: async () => [
          { serviceCode: 'B', name: 'Cara', carrier: 'X', priceCents: 5000, days: 1 },
          { serviceCode: 'A', name: 'Barata', carrier: 'X', priceCents: 1000, days: 9 },
        ],
      },
    })
    const p = await produto(c.dono)
    const q = await quoteShipping(c.ctxCliente, { addressId: await enderecoDe(c.ctxCliente), lines: [{ productId: p.id, quantity: 1 }] })
    expect(q.options.map((o) => o.serviceCode)).toEqual(['A', 'B'])
  })
})
