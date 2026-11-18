import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QUOTE_TTL_MIN, quoteExpired, readQuote, signQuote, type QuotePayload } from '@/server/domain/store/quote-token'

const PAYLOAD: QuotePayload = {
  businessId: '11111111-1111-4111-8111-111111111111',
  customerId: '22222222-2222-4222-8222-222222222222',
  addressId: '33333333-3333-4333-8333-333333333333',
  postalCode: '01310100',
  cartHash: 'a'.repeat(64),
  serviceCode: 'PAC',
  serviceName: 'PAC',
  priceCents: 2150,
  days: 7,
  expiresAtMs: 1_800_000_000_000,
}

describe('cotação assinada', () => {
  test('o token assinado volta igual, e o prazo é de 30 minutos', () => {
    expect(readQuote(signQuote(PAYLOAD))).toEqual(PAYLOAD)
    expect(QUOTE_TTL_MIN).toBe(30)
  })

  test('um caractere trocado em QUALQUER posição invalida o token (payload, assinatura e separadores)', () => {
    const token = signQuote(PAYLOAD)
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    let aceitos = 0
    for (let i = 0; i < token.length; i++) {
      const original = token[i] ?? ''
      // Troca por outro caractere do alfabeto, sempre diferente do original (testa também as trocas na ponta da assinatura).
      for (const troca of [alfabeto[(alfabeto.indexOf(original) + 1) % alfabeto.length] ?? 'A', alfabeto[(alfabeto.indexOf(original) + 17) % alfabeto.length] ?? 'B']) {
        const ruim = `${token.slice(0, i)}${troca === original ? 'Z' : troca}${token.slice(i + 1)}`
        if (readQuote(ruim) !== null) aceitos++
      }
    }
    expect(aceitos).toBe(0)
  })

  test('truncado, com sobra, vazio, sem partes ou lixo: null', () => {
    const token = signQuote(PAYLOAD)
    for (const ruim of ['', '.', '..', 'v1', 'v1.a.b', token.slice(0, -1), `${token}x`, `${token}.x`, token.replace('v1.', 'v2.'), token.toUpperCase(), ' ' + token, 'a'.repeat(5000), `v1.${'a'.repeat(100)}.${'b'.repeat(43)}`]) {
      expect(readQuote(ruim), ruim.slice(0, 20)).toBeNull()
    }
  })

  test('misturar o payload de um token com a assinatura de outro: null', () => {
    const a = signQuote(PAYLOAD)
    const b = signQuote({ ...PAYLOAD, priceCents: 1 })
    const [v, pa] = a.split('.') as [string, string]
    const mac = b.split('.')[2] ?? ''
    expect(readQuote([v, pa, mac].join('.'))).toBeNull()
  })

  test('não vale nada para quem não tem a chave: assinatura calculada com outra chave é recusada', () => {
    const payload = Buffer.from(JSON.stringify(PAYLOAD)).toString('base64url')
    const mac = createHmac('sha256', 'uma-chave-qualquer').update(payload).digest('base64url')
    expect(readQuote(`v1.${payload}.${mac}`)).toBeNull()
  })

  test('formato do payload é conferido: campo faltando, tipo errado ou valor impossível dão null (mesmo assinado)', async () => {
    // Assinado de verdade (com a chave do sistema), mas com payload fora do formato: só dá para fabricar passando por signQuote com tipos forçados.
    const ruins: unknown[] = [
      { ...PAYLOAD, priceCents: -1 },
      { ...PAYLOAD, priceCents: 21.5 },
      { ...PAYLOAD, days: -1 },
      { ...PAYLOAD, serviceCode: '' },
      { ...PAYLOAD, postalCode: '123' },
      { ...PAYLOAD, expiresAtMs: 'amanhã' },
      { ...PAYLOAD, businessId: 'nao-uuid' },
      { ...PAYLOAD, extra: 1 },
    ]
    for (const r of ruins) expect(readQuote(signQuote(r as QuotePayload)), JSON.stringify(r)).toBeNull()
    const semEndereco: Partial<QuotePayload> = { ...PAYLOAD }
    delete semEndereco.addressId
    expect(readQuote(signQuote(semEndereco as QuotePayload))).toBeNull()
  })

  test('quoteExpired: vale até o instante de vencimento, inclusive; depois disso venceu', () => {
    expect(quoteExpired(PAYLOAD, new Date(PAYLOAD.expiresAtMs))).toBe(false)
    expect(quoteExpired(PAYLOAD, new Date(PAYLOAD.expiresAtMs - 1))).toBe(false)
    expect(quoteExpired(PAYLOAD, new Date(PAYLOAD.expiresAtMs + 1))).toBe(true)
  })

  test('readQuote devolve também o token vencido: quem decide o prazo é o pedido (quote_expired, não invalid_quote)', () => {
    expect(readQuote(signQuote({ ...PAYLOAD, expiresAtMs: 1 }))).toMatchObject({ expiresAtMs: 1 })
  })
})

describe('outra APP_SECRET', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllEnvs())

  test('o token de uma chave não abre com a chave de outra', async () => {
    vi.stubEnv('APP_SECRET', 'segredo-a-de-teste-com-no-minimo-32-caracteres-ok')
    const a = await import('@/server/domain/store/quote-token')
    const token = a.signQuote(PAYLOAD)
    expect(a.readQuote(token)).toEqual(PAYLOAD)
    vi.resetModules()
    vi.stubEnv('APP_SECRET', 'segredo-b-de-teste-com-no-minimo-32-caracteres-ok')
    const b = await import('@/server/domain/store/quote-token')
    expect(b.readQuote(token)).toBeNull()
    expect(b.readQuote(b.signQuote(PAYLOAD))).toEqual(PAYLOAD)
  })
})
