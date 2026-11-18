import 'server-only'
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { z } from '@/server/domain/errors'
import { env } from '@/server/env'

/**
 * Cotação de frete assinada. O app nunca manda o preço do frete: manda o token que o servidor assinou ao cotar, e o pedido
 * só vale se o token confere (mesma conta, mesmo cliente, mesmo endereço e CEP, mesmo carrinho) e não venceu. Formato
 * `v1.<payload em base64url>.<HMAC-SHA256 em base64url>`, com chave HKDF do APP_SECRET de rótulo próprio.
 */

export const QUOTE_TTL_MIN = 30

export type QuotePayload = {
  businessId: string
  customerId: string
  addressId: string
  postalCode: string
  cartHash: string
  serviceCode: string
  serviceName: string
  priceCents: number
  days: number
  expiresAtMs: number
}

const VERSION = 'v1'
const MAX_TOKEN = 2000

const payloadSchema = z.strictObject({
  businessId: z.uuid(),
  customerId: z.uuid(),
  addressId: z.uuid(),
  postalCode: z.string().regex(/^\d{8}$/),
  cartHash: z.string().regex(/^[0-9a-f]{64}$/),
  serviceCode: z.string().min(1).max(60),
  serviceName: z.string().min(1).max(120),
  priceCents: z.number().int().min(0).max(100_000_000),
  days: z.number().int().min(0).max(1000),
  expiresAtMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})

let chave: Buffer | undefined

function quoteKey(): Buffer {
  chave ??= Buffer.from(hkdfSync('sha256', env.APP_SECRET, '', 'agendaflui/shipping-quote/v1', 32))
  return chave
}

function mac(signed: string): string {
  return createHmac('sha256', quoteKey()).update(signed).digest('base64url')
}

export function signQuote(p: QuotePayload): string {
  const body = Buffer.from(JSON.stringify(p), 'utf8').toString('base64url')
  return `${VERSION}.${body}.${mac(`${VERSION}.${body}`)}`
}

/**
 * Confere a assinatura (comparação em tempo constante, sobre o texto: nenhum caractere trocado passa) e o formato do payload.
 * NÃO olha o prazo: quem usa decide (`quoteExpired`), porque cotação vencida e cotação inválida têm respostas diferentes.
 */
export function readQuote(token: string): QuotePayload | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) return null
  const [, body, given] = parts as [string, string, string]
  const expected = Buffer.from(mac(`${VERSION}.${body}`), 'utf8')
  const received = Buffer.from(given, 'utf8')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** A cotação vale até o instante de vencimento, inclusive. */
export function quoteExpired(p: Pick<QuotePayload, 'expiresAtMs'>, now: Date): boolean {
  return now.getTime() > p.expiresAtMs
}
