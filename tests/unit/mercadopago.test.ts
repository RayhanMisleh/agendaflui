import { createHmac } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { IntegrationError } from '@/server/integrations/errors'
import { centsToReais, createMercadoPagoGateway, reaisToCents, verifyMercadoPagoSignature } from '@/server/integrations/mercadopago'
import { fromIsoOffsetInstant } from '@/server/time'

const SEGREDO = 'segredo-do-webhook-0123456789'
const manifesto = (id: string, req: string | null, ts: string) => `id:${id};${req === null ? '' : `request-id:${req};`}ts:${ts};`
const hmac = (m: string, s = SEGREDO) => createHmac('sha256', s).update(m).digest('hex')
const base = { secret: SEGREDO, xRequestId: 'req-abc', dataId: '123ABC' }
const cabecalho = (ts = '1700000000', v1 = hmac(manifesto('123abc', 'req-abc', ts))) => `ts=${ts},v1=${v1}`

describe('verifyMercadoPagoSignature', () => {
  test('o vetor calculado no teste vale (data.id em minúsculas no manifesto)', () => {
    expect(verifyMercadoPagoSignature({ ...base, xSignature: cabecalho() })).toBe(true)
    expect(verifyMercadoPagoSignature({ ...base, dataId: '123abc', xSignature: cabecalho() })).toBe(true)
  })

  test('sem x-request-id o trecho request-id sai do manifesto', () => {
    const v1 = hmac(manifesto('123abc', null, '1700000000'))
    expect(verifyMercadoPagoSignature({ ...base, xRequestId: null, xSignature: `ts=1700000000,v1=${v1}` })).toBe(true)
    // assinado com request-id e conferido sem: falso
    expect(verifyMercadoPagoSignature({ ...base, xRequestId: null, xSignature: cabecalho() })).toBe(false)
  })

  test('um caractere trocado em v1, outro ts, outro data.id, outro request-id ou outro segredo: falso', () => {
    const v1 = hmac(manifesto('123abc', 'req-abc', '1700000000'))
    const trocado = `${v1.slice(0, -1)}${v1.endsWith('0') ? '1' : '0'}`
    expect(verifyMercadoPagoSignature({ ...base, xSignature: `ts=1700000000,v1=${trocado}` })).toBe(false)
    expect(verifyMercadoPagoSignature({ ...base, xSignature: `ts=1700000001,v1=${v1}` })).toBe(false)
    expect(verifyMercadoPagoSignature({ ...base, dataId: '123ABD', xSignature: cabecalho() })).toBe(false)
    expect(verifyMercadoPagoSignature({ ...base, xRequestId: 'req-outro', xSignature: cabecalho() })).toBe(false)
    expect(verifyMercadoPagoSignature({ ...base, secret: 'outro-segredo-0123456789', xSignature: cabecalho() })).toBe(false)
  })

  test('cabeçalho ausente, vazio, sem v1, sem ts, malformado ou repetido: falso', () => {
    const v1 = hmac(manifesto('123abc', 'req-abc', '1700000000'))
    for (const h of [null, '', 'ts=1700000000', `v1=${v1}`, 'ts=1700000000,v1=', 'ts=1700000000,v1=zz', `ts=abc,v1=${v1}`, `ts=1700000000,v1=${v1.slice(2)}`, `ts=1700000000,v1=${v1},v1=${v1}`, `ts=1700000000,ts=1700000000,v1=${v1}`, 'lixo']) {
      expect(verifyMercadoPagoSignature({ ...base, xSignature: h }), String(h)).toBe(false)
    }
    expect(verifyMercadoPagoSignature({ ...base, dataId: '', xSignature: cabecalho() })).toBe(false)
    expect(verifyMercadoPagoSignature({ ...base, secret: '', xSignature: cabecalho() })).toBe(false)
  })
})

describe('conversões de dinheiro', () => {
  test('centavos para reais por texto', () => {
    expect(centsToReais(1990)).toBe('19.90')
    expect(centsToReais(5)).toBe('0.05')
    expect(centsToReais(100)).toBe('1.00')
    expect(centsToReais(123456)).toBe('1234.56')
  })

  test('reais para centavos por texto, sem ponto flutuante', () => {
    expect(reaisToCents('19.90')).toBe(1990)
    expect(reaisToCents('0.05')).toBe(5)
    expect(reaisToCents('10.1')).toBe(1010)
    expect(reaisToCents(19.9)).toBe(1990)
    expect(reaisToCents(0.07)).toBe(7)
    expect(reaisToCents(1.15)).toBe(115)
    expect(reaisToCents(4.35)).toBe(435)
    expect(reaisToCents('10.001')).toBeNull()
    expect(reaisToCents('-1')).toBeNull()
    expect(reaisToCents('1e3')).toBeNull()
    expect(reaisToCents('')).toBeNull()
    expect(reaisToCents(null)).toBeNull()
  })

  test('ida e volta', () => {
    for (const c of [1, 5, 99, 100, 1010, 1990, 2150, 99999]) expect(reaisToCents(centsToReais(c))).toBe(c)
  })
})

describe('fromIsoOffsetInstant', () => {
  test('lê deslocamento e Z', () => {
    expect(fromIsoOffsetInstant('2026-11-17T11:00:00.000-04:00').toISOString()).toBe('2026-11-17T15:00:00.000Z')
    expect(fromIsoOffsetInstant('2026-11-17T18:30:00+03:30').toISOString()).toBe('2026-11-17T15:00:00.000Z')
    expect(fromIsoOffsetInstant('2026-11-17T15:00:00.000Z').toISOString()).toBe('2026-11-17T15:00:00.000Z')
    expect(() => fromIsoOffsetInstant('17/11/2026')).toThrow(RangeError)
    expect(() => fromIsoOffsetInstant('2026-11-17T11:00:00-25:00')).toThrow(RangeError)
  })
})

type Chamada = { url: string; init: RequestInit }
function gateway(resposta: () => Response | Promise<Response>, timeoutMs = 50) {
  const chamadas: Chamada[] = []
  const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    return resposta()
  }) as unknown as typeof fetch
  return { gw: createMercadoPagoGateway({ fetch: fetchFalso, timeoutMs }), chamadas }
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
const TOKEN = 'TEST-token-super-secreto-123456'
const pref = {
  orderId: '11111111-1111-4111-8111-111111111111',
  items: [
    { id: 'p1', title: 'Pomada', quantity: 2, unitPriceCents: 1990 },
    { id: 'shipping', title: 'Frete', quantity: 1, unitPriceCents: 5 },
  ],
  payerEmail: 'maria@exemplo.test',
  notificationUrl: 'https://app.exemplo.test/webhooks/mercadopago/chave',
  backUrl: null as string | null,
  expiresAt: new Date('2026-11-17T16:00:00Z'),
}

describe('gateway real do Mercado Pago (fetch falso)', () => {
  test('createPreference: corpo, cabeçalhos e resposta', async () => {
    const { gw, chamadas } = gateway(() => json({ id: 'pref-1', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' }, 201))
    const r = await gw.createPreference(TOKEN, pref)
    expect(r).toEqual({ preferenceId: 'pref-1', checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' })
    const c = chamadas[0]!
    expect(c.url).toBe('https://api.mercadopago.com/checkout/preferences')
    expect(c.init.method).toBe('POST')
    const h = new Headers(c.init.headers)
    expect(h.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(h.get('x-idempotency-key')).toBe(pref.orderId)
    const corpo = JSON.parse(String(c.init.body)) as Record<string, unknown>
    expect(corpo.items).toEqual([
      { id: 'p1', title: 'Pomada', quantity: 2, unit_price: 19.9, currency_id: 'BRL' },
      { id: 'shipping', title: 'Frete', quantity: 1, unit_price: 0.05, currency_id: 'BRL' },
    ])
    expect(corpo.external_reference).toBe(pref.orderId)
    expect(corpo.notification_url).toBe(pref.notificationUrl)
    expect(corpo.expires).toBe(true)
    expect(corpo.expiration_date_to).toBe('2026-11-17T16:00:00.000Z')
    expect(corpo.date_of_expiration).toBe('2026-11-17T16:00:00.000Z')
    expect(corpo.payment_methods).toEqual({ excluded_payment_types: [{ id: 'ticket' }] })
    expect(corpo.payer).toEqual({ email: 'maria@exemplo.test' })
    expect(corpo.back_urls).toBeUndefined()
    expect(corpo.auto_return).toBeUndefined()
    expect(JSON.stringify(corpo)).not.toContain(TOKEN)
  })

  test('com backUrl: back_urls de sucesso, pendente e falha e auto_return approved; sem e-mail, sem payer', async () => {
    const { gw, chamadas } = gateway(() => json({ id: 'pref-1', init_point: 'https://mp.test/x' }))
    await gw.createPreference(TOKEN, { ...pref, payerEmail: null, backUrl: 'https://app.exemplo.test/pedido' })
    const corpo = JSON.parse(String(chamadas[0]!.init.body)) as Record<string, unknown>
    expect(corpo.back_urls).toEqual({ success: 'https://app.exemplo.test/pedido', pending: 'https://app.exemplo.test/pedido', failure: 'https://app.exemplo.test/pedido' })
    expect(corpo.auto_return).toBe('approved')
    expect(corpo.payer).toBeUndefined()
  })

  test('getPayment: lê situação, valor por texto, moeda, referência e data com deslocamento', async () => {
    const { gw, chamadas } = gateway(() =>
      json({ id: 987654321, status: 'approved', status_detail: 'accredited', transaction_amount: 19.9, currency_id: 'BRL', external_reference: pref.orderId, date_approved: '2026-11-17T11:05:00.000-04:00' }),
    )
    const p = await gw.getPayment(TOKEN, '987654321')
    expect(chamadas[0]!.url).toBe('https://api.mercadopago.com/v1/payments/987654321')
    expect(new Headers(chamadas[0]!.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(p).toEqual({ id: '987654321', status: 'approved', statusDetail: 'accredited', amountCents: 1990, currency: 'BRL', externalReference: pref.orderId, approvedAt: new Date('2026-11-17T15:05:00.000Z') })
  })

  test('getPayment recusa id que não é só dígitos sem chamar a rede', async () => {
    const { gw, chamadas } = gateway(() => json({}))
    for (const id of ['../x', '12/34', '', '12 34', 'abc', '1?a=b']) await expect(gw.getPayment(TOKEN, id), id).rejects.toBeInstanceOf(IntegrationError)
    expect(chamadas).toHaveLength(0)
  })

  test('searchPaymentsByReference: URL com external_reference e lista', async () => {
    const item = { id: 1, status: 'pending', status_detail: null, transaction_amount: 10, currency_id: 'BRL', external_reference: pref.orderId, date_approved: null }
    const { gw, chamadas } = gateway(() => json({ results: [item, { ...item, id: 2, status: 'refunded' }] }))
    const r = await gw.searchPaymentsByReference(TOKEN, pref.orderId)
    expect(chamadas[0]!.url).toContain('https://api.mercadopago.com/v1/payments/search?')
    expect(chamadas[0]!.url).toContain(`external_reference=${pref.orderId}`)
    expect(r.map((p) => [p.id, p.status, p.amountCents, p.approvedAt])).toEqual([['1', 'pending', 1000, null], ['2', 'refunded', 1000, null]])
  })

  test('resposta fora do formato, valor com mais de duas casas, situação desconhecida: invalid_response (nunca pagamento válido)', async () => {
    const ruim = { id: 5, status: 'approved', transaction_amount: 10, currency_id: 'BRL', external_reference: null }
    for (const corpo of [{ ...ruim, transaction_amount: 10.123 }, { ...ruim, status: 'inventado' }, { ...ruim, currency_id: undefined }, { ...ruim, id: 'abc' }, [], 'texto']) {
      const { gw } = gateway(() => json(corpo))
      await expect(gw.getPayment(TOKEN, '5'), JSON.stringify(corpo)).rejects.toMatchObject({ code: 'invalid_response' })
    }
    const { gw } = gateway(() => json({ results: [{ ...ruim, transaction_amount: 'x' }] }))
    await expect(gw.searchPaymentsByReference(TOKEN, pref.orderId)).rejects.toMatchObject({ code: 'invalid_response' })
    const { gw: sem } = gateway(() => json({}))
    await expect(sem.searchPaymentsByReference(TOKEN, pref.orderId)).rejects.toMatchObject({ code: 'invalid_response' })
    const { gw: html } = gateway(() => new Response('<html>', { status: 200 }))
    await expect(html.getPayment(TOKEN, '5')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  test('erros: 5xx e 429 indisponível, 401 e 404 recusado, falha de rede indisponível, nunca com o token na mensagem', async () => {
    const casos: [number, string][] = [[500, 'unavailable'], [503, 'unavailable'], [429, 'unavailable'], [401, 'rejected'], [403, 'rejected'], [404, 'rejected'], [400, 'rejected']]
    for (const [status, code] of casos) {
      const { gw } = gateway(() => json({ message: `token ${TOKEN} inválido` }, status))
      const erro = await gw.getPayment(TOKEN, '5').catch((e: unknown) => e)
      expect(erro, String(status)).toBeInstanceOf(IntegrationError)
      expect((erro as IntegrationError).code).toBe(code)
      expect((erro as IntegrationError).message).not.toContain(TOKEN)
    }
    const { gw } = gateway(() => {
      throw new TypeError(`falha com ${TOKEN}`)
    })
    const erro = await gw.createPreference(TOKEN, pref).catch((e: unknown) => e)
    expect((erro as IntegrationError).code).toBe('unavailable')
    expect((erro as IntegrationError).message).not.toContain(TOKEN)
  })

  test('tempo limite: resposta que nunca chega vira timeout', async () => {
    const { gw } = gateway(() => new Promise<Response>(() => undefined), 20)
    await expect(gw.getPayment(TOKEN, '5')).rejects.toMatchObject({ code: 'timeout' })
  })
})
