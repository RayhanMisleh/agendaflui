import { describe, expect, test } from 'vitest'
import { IntegrationError } from '@/server/integrations/errors'
import { createFrenetGateway } from '@/server/integrations/frenet'
import { fetchWithTimeout, readJson } from '@/server/integrations/http'
import { createMercadoPagoGateway } from '@/server/integrations/mercadopago'
import { createViaCepGateway } from '@/server/integrations/viacep'

/** Responde 200 com os cabeçalhos e deixa o corpo aberto para sempre: o tempo limite tem de valer também para a leitura dele. */
const corpoQueNuncaFecha = (): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"results":['))
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

const dentroDoPrazo = async (p: Promise<unknown>, ms = 1500): Promise<unknown> => {
  const inicio = Date.now()
  const erro = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(Date.now() - inicio).toBeLessThan(ms)
  return erro
}

describe('o tempo limite cobre a leitura do corpo', () => {
  test('fetchWithTimeout + readJson: corpo que nunca fecha vira timeout', async () => {
    const erro = await dentroDoPrazo(fetchWithTimeout(async () => corpoQueNuncaFecha(), 'https://x.test', {}, 40, 'O serviço').then((r) => readJson(r, 'O serviço')))
    expect(erro).toBeInstanceOf(IntegrationError)
    expect((erro as IntegrationError).code).toBe('timeout')
  })

  test('Frenet, ViaCEP e Mercado Pago: corpo travado dá timeout dentro do prazo', async () => {
    const f = async () => corpoQueNuncaFecha()
    const casos: [string, () => Promise<unknown>][] = [
      ['frenet', () => createFrenetGateway({ fetch: f, timeoutMs: 40 }).quote('token-frenet-0123456789', { sellerCep: '01310100', recipientCep: '20040020', invoiceValueCents: 1000, items: [{ sku: 'a', quantity: 1, weightKg: 1, lengthCm: 10, heightCm: 10, widthCm: 10 }] })],
      ['viacep', () => createViaCepGateway({ fetch: f, timeoutMs: 40 }).lookup('01310100')],
      ['mercadopago getPayment', () => createMercadoPagoGateway({ fetch: f, timeoutMs: 40 }).getPayment('TEST-token-0123456789', '123')],
      ['mercadopago search', () => createMercadoPagoGateway({ fetch: f, timeoutMs: 40 }).searchPaymentsByReference('TEST-token-0123456789', 'x')],
    ]
    for (const [nome, chamar] of casos) {
      const erro = await dentroDoPrazo(chamar())
      expect((erro as IntegrationError | null)?.code, nome).toBe('timeout')
    }
  })

  test('resposta normal continua lendo o corpo inteiro; erro de status não lê o corpo', async () => {
    const r = await fetchWithTimeout(async () => new Response('{"a":1}', { status: 200 }), 'https://x.test', {}, 1000, 'O serviço')
    expect(await readJson(r, 'O serviço')).toEqual({ a: 1 })
    const ruim = await fetchWithTimeout(async () => corpoQueNuncaFecha(), 'https://x.test', {}, 40, 'O serviço').catch(() => null)
    expect(ruim).toBeNull()
    const e500 = await dentroDoPrazo(createViaCepGateway({ fetch: async () => new Response(new ReadableStream({ start() {} }), { status: 503 }), timeoutMs: 40 }).lookup('01310100'))
    expect((e500 as IntegrationError).code).toBe('unavailable')
  })
})
