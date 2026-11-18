import { IntegrationError } from './errors'
import { fetchWithTimeout, readJson } from './http'
import type { FrenetGateway, FrenetQuote, FrenetService } from './index'

const URL_COTACAO = 'https://api.frenet.com.br/shipping/quote'
const TIMEOUT_MS = 8_000
const SERVICO = 'O cálculo de frete'
/** Teto de um frete: R$ 1.000.000,00 (acima disso o texto não é preço de frete). */
const MAX_CENTS = 100_000_000
/** Teto de um frete oferecido: R$ 10.000,00, e prazo até 1.000 dias: os mesmos limites da cotação assinada (`quote-token.ts`). */
const MAX_SHIPPING_CENTS = 1_000_000
const MAX_SHIPPING_DAYS = 1000

/**
 * Preço em reais, escrito com ponto decimal ("21.5", "21.50", 21.5), em centavos inteiros e SEM ponto flutuante: o texto é
 * lido por partes. O que não for dinheiro (vazio, negativo, vírgula, mais de duas casas, notação científica) vira `null`.
 */
export function priceToCents(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : null
  if (text === null) return null
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text)
  if (!m) return null
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0')
  return cents <= MAX_CENTS ? cents : null
}

/** Dias de prazo, escritos só com dígitos. */
function daysOf(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isInteger(value) ? String(value) : null
  return text !== null && /^\d{1,4}$/.test(text) ? Number(text) : null
}

function asText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.trim().length <= max ? value.trim() : null
}

function toService(raw: unknown): FrenetService | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const s: Record<string, unknown> = { ...raw }
  if (s.Error === true) return null
  const serviceCode = asText(s.ServiceCode, 60)
  const name = asText(s.ServiceDescription, 120) ?? asText(s.ServiceName, 120)
  const priceCents = priceToCents(s.ShippingPrice)
  const days = daysOf(s.DeliveryTime)
  if (serviceCode === null || name === null || priceCents === null || days === null) return null
  // Opção que o token assinado não aceitaria não é oferecida: o cliente a escolheria e o pedido falharia sem culpa dele.
  if (priceCents > MAX_SHIPPING_CENTS || days > MAX_SHIPPING_DAYS) return null
  return { serviceCode, name, carrier: asText(s.Carrier, 120) ?? name, priceCents, days }
}

/** "R$" em reais com duas casas, a partir de centavos inteiros, só por texto (o valor da nota que a Frenet pede). */
function reais(cents: number): number {
  const whole = Math.trunc(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  return Number(`${whole}.${rest}`)
}

/**
 * Frenet real: `POST https://api.frenet.com.br/shipping/quote` com o cabeçalho `token`. O token nunca vai para URL, log ou
 * mensagem de erro. Serviço com `Error: true` ou sem preço, prazo ou código é ignorado.
 */
export function createFrenetGateway(o: { fetch?: typeof fetch; timeoutMs?: number } = {}): FrenetGateway {
  const doFetch = o.fetch ?? fetch
  return {
    async quote(token: string, q: FrenetQuote): Promise<FrenetService[]> {
      const body = {
        SellerCEP: q.sellerCep,
        RecipientCEP: q.recipientCep,
        ShipmentInvoiceValue: reais(q.invoiceValueCents),
        RecipientCountry: 'BR',
        ShippingItemArray: q.items.map((i) => ({ SKU: i.sku, Quantity: i.quantity, Weight: i.weightKg, Length: i.lengthCm, Height: i.heightCm, Width: i.widthCm })),
      }
      const res = await fetchWithTimeout(
        doFetch,
        URL_COTACAO,
        { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', token }, body: JSON.stringify(body) },
        o.timeoutMs ?? TIMEOUT_MS,
        SERVICO,
      )
      if (res.status >= 500 || res.status === 429) throw new IntegrationError('unavailable', `${SERVICO} está fora do ar.`)
      if (!res.ok) throw new IntegrationError('rejected', `${SERVICO} recusou o pedido.`)
      const json = await readJson(res, SERVICO)
      // O nome do campo é assim mesmo na API da Frenet ("Sevices").
      const list = typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>).ShippingSevicesArray : undefined
      if (!Array.isArray(list)) throw new IntegrationError('invalid_response', `${SERVICO} respondeu em um formato inesperado.`)
      return list.flatMap((raw: unknown) => {
        const s = toService(raw)
        return s === null ? [] : [s]
      })
    },
  }
}
