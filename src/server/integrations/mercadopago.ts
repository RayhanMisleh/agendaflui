import { createHmac, timingSafeEqual } from 'node:crypto'
import { fromIsoOffsetInstant, toIsoInstant } from '@/server/time'
import { IntegrationError } from './errors'
import { fetchWithTimeout, readJson } from './http'
import { priceToCents } from './frenet'
import type { MercadoPagoGateway, MpPayment, MpPaymentStatus } from './index'

export type { MpPayment, MpPaymentStatus }

const API = 'https://api.mercadopago.com'
const TIMEOUT_MS = 10_000
const SERVICO = 'O Mercado Pago'
const STATUSES: readonly MpPaymentStatus[] = ['pending', 'approved', 'authorized', 'in_process', 'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back']

/** Centavos inteiros em reais com duas casas, só por texto: `1990` → `"19.90"`, `5` → `"0.05"`. */
export function centsToReais(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('Valor em centavos inválido.')
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** Reais (texto ou número do JSON) em centavos, lendo o texto por partes: nunca `x * 100`. Formato inválido: `null`. */
export function reaisToCents(value: unknown): number | null {
  return priceToCents(value)
}

/**
 * Confere o `x-signature` do webhook. Formato: `ts=<ts>,v1=<hex>`; manifesto `id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;`
 * (sem `x-request-id` o trecho `request-id` sai); HMAC-SHA256 com o segredo do webhook, comparado em tempo constante.
 * Qualquer parte ausente ou malformada dá `false`. Não há janela de tempo: o estado do pagamento sempre vem da consulta.
 */
export function verifyMercadoPagoSignature(i: { secret: string; xSignature: string | null; xRequestId: string | null; dataId: string }): boolean {
  if (i.secret === '' || i.dataId === '' || i.xSignature === null || i.xSignature.length > 500) return false
  let ts: string | null = null
  let v1: string | null = null
  for (const part of i.xSignature.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) return false
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name === 'ts') {
      if (ts !== null) return false
      ts = value
    } else if (name === 'v1') {
      if (v1 !== null) return false
      v1 = value
    }
  }
  if (ts === null || v1 === null || !/^\d{1,20}$/.test(ts) || !/^[0-9a-fA-F]{64}$/.test(v1)) return false
  const request = i.xRequestId === null || i.xRequestId === '' ? '' : `request-id:${i.xRequestId};`
  const manifest = `id:${i.dataId.toLowerCase()};${request}ts:${ts};`
  const expected = createHmac('sha256', i.secret).update(manifest).digest()
  const received = Buffer.from(v1, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

const invalid = (): IntegrationError => new IntegrationError('invalid_response', `${SERVICO} respondeu em um formato inesperado.`)

function toPayment(raw: unknown): MpPayment {
  const r = asRecord(raw)
  if (r === null) throw invalid()
  const id = typeof r.id === 'number' && Number.isSafeInteger(r.id) && r.id > 0 ? String(r.id) : typeof r.id === 'string' && /^\d{1,20}$/.test(r.id) ? r.id : null
  const status = STATUSES.find((s) => s === r.status)
  const amountCents = reaisToCents(r.transaction_amount)
  const currency = typeof r.currency_id === 'string' && /^[A-Za-z]{1,10}$/.test(r.currency_id) ? r.currency_id.toUpperCase() : null
  if (id === null || status === undefined || amountCents === null || currency === null) throw invalid()
  const reference = typeof r.external_reference === 'string' && r.external_reference !== '' ? r.external_reference.slice(0, 200) : null
  let approvedAt: Date | null = null
  if (typeof r.date_approved === 'string') {
    try {
      approvedAt = fromIsoOffsetInstant(r.date_approved)
    } catch {
      approvedAt = null
    }
  }
  return {
    id,
    status,
    statusDetail: typeof r.status_detail === 'string' ? r.status_detail.slice(0, 100) : null,
    amountCents,
    currency,
    externalReference: reference,
    approvedAt,
  }
}

function failFor(status: number): IntegrationError {
  if (status >= 500 || status === 429) return new IntegrationError('unavailable', `${SERVICO} está fora do ar.`)
  return new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
}

/**
 * Mercado Pago real (Checkout Pro). O token vai só no cabeçalho `Authorization`; nunca em URL, log ou mensagem de erro.
 * Valores em reais saem por TEXTO (`centsToReais`) e voltam por texto (`reaisToCents`).
 */
export function createMercadoPagoGateway(o: { fetch?: typeof fetch; timeoutMs?: number } = {}): MercadoPagoGateway {
  const doFetch = o.fetch ?? fetch
  const call = (url: string, init: RequestInit) => fetchWithTimeout(doFetch, url, init, o.timeoutMs ?? TIMEOUT_MS, SERVICO)
  const headers = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({ accept: 'application/json', authorization: `Bearer ${token}`, ...extra })
  return {
    async createPreference(token, p) {
      const backUrls = p.backUrl === null ? {} : { back_urls: { success: p.backUrl, pending: p.backUrl, failure: p.backUrl }, auto_return: 'approved' }
      const expires = toIsoInstant(p.expiresAt)
      const body = {
        items: p.items.map((i) => ({ id: i.id, title: i.title.slice(0, 250), quantity: i.quantity, unit_price: Number(centsToReais(i.unitPriceCents)), currency_id: 'BRL' })),
        external_reference: p.orderId,
        notification_url: p.notificationUrl,
        ...(p.payerEmail === null ? {} : { payer: { email: p.payerEmail } }),
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
        expires: true,
        expiration_date_to: expires,
        date_of_expiration: expires,
        ...backUrls,
      }
      const res = await call(`${API}/checkout/preferences`, {
        method: 'POST',
        headers: headers(token, { 'content-type': 'application/json', 'x-idempotency-key': p.orderId }),
        body: JSON.stringify(body),
      })
      if (!res.ok) throw failFor(res.status)
      const json = asRecord(await readJson(res, SERVICO))
      const preferenceId = typeof json?.id === 'string' && json.id !== '' ? json.id : null
      const checkoutUrl = typeof json?.init_point === 'string' && json.init_point.startsWith('https://') ? json.init_point : null
      if (preferenceId === null || checkoutUrl === null) throw invalid()
      return { preferenceId, checkoutUrl }
    },
    async getPayment(token, paymentId) {
      if (!/^\d{1,20}$/.test(paymentId)) throw new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
      const res = await call(`${API}/v1/payments/${paymentId}`, { method: 'GET', headers: headers(token) })
      if (!res.ok) throw failFor(res.status)
      return toPayment(await readJson(res, SERVICO))
    },
    async searchPaymentsByReference(token, orderId) {
      const query = new URLSearchParams({ external_reference: orderId, sort: 'date_created', criteria: 'desc', limit: '50' })
      const res = await call(`${API}/v1/payments/search?${query.toString()}`, { method: 'GET', headers: headers(token) })
      if (!res.ok) throw failFor(res.status)
      const list = asRecord(await readJson(res, SERVICO))?.results
      if (!Array.isArray(list)) throw invalid()
      return list.map((raw: unknown) => toPayment(raw))
    },
  }
}
