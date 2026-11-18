import { afterEach, describe, expect, test, vi } from 'vitest'
import { IntegrationError } from '@/server/integrations/errors'
import { fakeFrenet } from '@/server/integrations/fakes'
import { createFrenetGateway, priceToCents } from '@/server/integrations/frenet'

const TOKEN = 'FRENET-TOKEN-0123456789-Vb6D'
const Q = {
  sellerCep: '01310100',
  recipientCep: '20040020',
  invoiceValueCents: 5990,
  items: [{ sku: 'p1', quantity: 2, weightKg: 0.5, lengthCm: 20, heightCm: 10, widthCm: 30 }],
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
const servico = (o: Record<string, unknown> = {}) => ({ ServiceCode: '04510', ServiceDescription: 'PAC', Carrier: 'Correios', ShippingPrice: '21.5', DeliveryTime: '7', Error: false, ...o })
const resposta = (...servicos: unknown[]) => json({ ShippingSevicesArray: servicos })

afterEach(() => vi.useRealTimers())

describe('conversão de preço por texto', () => {
  test('texto com ponto decimal vira centavos sem passar por ponto flutuante', () => {
    expect(priceToCents('21.5')).toBe(2150)
    expect(priceToCents('21.50')).toBe(2150)
    expect(priceToCents('38.90')).toBe(3890)
    expect(priceToCents('0.05')).toBe(5)
    expect(priceToCents('0')).toBe(0)
    expect(priceToCents('10')).toBe(1000)
    expect(priceToCents(' 7.1 ')).toBe(710)
    expect(priceToCents(21.5)).toBe(2150)
    // Casos em que `Math.round(x * 100)` ou parseFloat erram: 1.005 e 0.29 * 100 = 28.999...
    expect(priceToCents('0.29')).toBe(29)
    expect(priceToCents('1.15')).toBe(115)
  })

  test('o que não é dinheiro de verdade vira null', () => {
    for (const ruim of ['', 'abc', '-1', '1.234', '1,50', '1.2.3', '.5', '5.', '1e3', 'NaN', '99999999999', null, undefined, {}, [], true, NaN, Infinity, 0.1 + 0.2]) {
      expect(priceToCents(ruim), String(ruim)).toBeNull()
    }
  })
})

describe('Frenet real (fetch falso)', () => {
  test('monta a chamada certa: POST, cabeçalho token, CEPs só com dígitos, valor em reais, itens com kg e cm', async () => {
    let chamada: { url: string; init: RequestInit } | null = null
    const g = createFrenetGateway({
      fetch: async (url, init) => {
        chamada = { url: String(url), init: init ?? {} }
        return resposta(servico())
      },
    })
    await g.quote(TOKEN, Q)
    expect(chamada).not.toBeNull()
    const c = chamada as unknown as { url: string; init: RequestInit }
    expect(c.url).toBe('https://api.frenet.com.br/shipping/quote')
    expect(c.init.method).toBe('POST')
    const headers = new Headers(c.init.headers)
    expect(headers.get('token')).toBe(TOKEN)
    expect(headers.get('content-type')).toBe('application/json')
    expect(c.url).not.toContain(TOKEN)
    expect(JSON.parse(String(c.init.body))).toEqual({
      SellerCEP: '01310100',
      RecipientCEP: '20040020',
      ShipmentInvoiceValue: 59.9,
      RecipientCountry: 'BR',
      ShippingItemArray: [{ SKU: 'p1', Quantity: 2, Weight: 0.5, Length: 20, Height: 10, Width: 30 }],
    })
  })

  test('converte "21.5" em 2150, o prazo em dias e ignora serviço com Error true ou sem preço', async () => {
    const g = createFrenetGateway({
      fetch: async () =>
        resposta(
          servico(),
          servico({ ServiceCode: 'SEDEX', ServiceDescription: 'SEDEX', ShippingPrice: '38.90', DeliveryTime: '3' }),
          servico({ ServiceCode: 'ERRO', Error: true, Msg: 'sem atendimento' }),
          servico({ ServiceCode: 'SEM-PRECO', ShippingPrice: undefined }),
          servico({ ServiceCode: 'PRECO-RUIM', ShippingPrice: '1,50' }),
          servico({ ServiceCode: 'SEM-PRAZO', DeliveryTime: 'logo' }),
          servico({ ServiceCode: '', ServiceDescription: 'sem código' }),
          'lixo',
        ),
    })
    expect(await g.quote(TOKEN, Q)).toEqual([
      { serviceCode: '04510', name: 'PAC', carrier: 'Correios', priceCents: 2150, days: 7 },
      { serviceCode: 'SEDEX', name: 'SEDEX', carrier: 'Correios', priceCents: 3890, days: 3 },
    ])
  })

  test('lista vazia e lista só com erros dão []', async () => {
    expect(await createFrenetGateway({ fetch: async () => resposta() }).quote(TOKEN, Q)).toEqual([])
    expect(await createFrenetGateway({ fetch: async () => resposta(servico({ Error: true })) }).quote(TOKEN, Q)).toEqual([])
  })

  test('erros do serviço: 500 unavailable, 401 e 403 rejected, rede unavailable, corpo ruim invalid_response', async () => {
    const codigo = async (f: typeof fetch) => ((await createFrenetGateway({ fetch: f }).quote(TOKEN, Q).catch((e: unknown) => e)) as IntegrationError).code
    expect(await codigo(async () => new Response('x', { status: 500 }))).toBe('unavailable')
    expect(await codigo(async () => new Response('x', { status: 503 }))).toBe('unavailable')
    expect(await codigo(async () => new Response('x', { status: 401 }))).toBe('rejected')
    expect(await codigo(async () => new Response('x', { status: 403 }))).toBe('rejected')
    expect(await codigo(async () => { throw new TypeError('fetch failed') })).toBe('unavailable')
    expect(await codigo(async () => new Response('<html>', { status: 200 }))).toBe('invalid_response')
    expect(await codigo(async () => json({}))).toBe('invalid_response')
    expect(await codigo(async () => json({ ShippingSevicesArray: 'x' }))).toBe('invalid_response')
    expect(await codigo(async () => json([]))).toBe('invalid_response')
  })

  test('demora de mais de 8 s vira timeout e aborta a chamada (relógio falso)', async () => {
    vi.useFakeTimers()
    let abortado = false
    const g = createFrenetGateway({
      fetch: (_url, init) =>
        new Promise<Response>((_ok, falha) => {
          init?.signal?.addEventListener('abort', () => {
            abortado = true
            falha(new DOMException('aborted', 'AbortError'))
          })
        }),
    })
    const p = g.quote(TOKEN, Q).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(7_999)
    expect(abortado).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    const e = (await p) as IntegrationError
    expect(e.code).toBe('timeout')
    expect(abortado).toBe(true)
  })

  test('nenhuma mensagem de erro traz o token, o CEP ou o texto da resposta', async () => {
    const falhas = [
      createFrenetGateway({ fetch: async () => new Response('token inválido FRENET-TOKEN-0123456789-Vb6D', { status: 401 }) }),
      createFrenetGateway({ fetch: async () => { throw new TypeError(`falhou com ${TOKEN}`) } }),
      createFrenetGateway({ fetch: async () => new Response(`corpo ${TOKEN}`, { status: 200 }) }),
    ]
    for (const g of falhas) {
      const e = (await g.quote(TOKEN, Q).catch((x: unknown) => x)) as IntegrationError
      expect(e).toBeInstanceOf(IntegrationError)
      expect(e.message).not.toContain(TOKEN)
      expect(e.message).not.toContain('01310100')
      expect(e.message).not.toContain('20040020')
    }
  })
})

describe('Frenet falsa', () => {
  test('devolve PAC (R$ 21,50, 7 dias) e SEDEX (R$ 38,90, 3 dias)', async () => {
    expect(await fakeFrenet().quote(TOKEN, Q)).toEqual([
      { serviceCode: 'PAC', name: 'PAC', carrier: 'Correios', priceCents: 2150, days: 7 },
      { serviceCode: 'SEDEX', name: 'SEDEX', carrier: 'Correios', priceCents: 3890, days: 3 },
    ])
  })
})
