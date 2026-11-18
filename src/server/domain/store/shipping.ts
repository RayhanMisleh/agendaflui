import type { TenantContext } from '@/server/auth/actor'
import { DomainError, z } from '@/server/domain/errors'
import { readFrenetToken } from '@/server/domain/platform/integration-secrets'
import { ownCustomerId } from '@/server/domain/store/addresses'
import { priceCart } from '@/server/domain/store/cart'
import type { RawCartLine } from '@/server/domain/store/cart'
import { QUOTE_TTL_MIN, signQuote } from '@/server/domain/store/quote-token'
import { loadStoreSettings } from '@/server/domain/store/settings'
import { integrations, IntegrationError } from '@/server/integrations'

export type ShippingQuote = {
  pickup: { available: boolean; instructions: string | null }
  options: { serviceCode: string; name: string; carrier: string; priceCents: number; days: number; quoteToken: string }[]
  /** Por que não há opção de entrega (em frase pronta para o cliente); nulo quando há opções. Nunca é erro HTTP. */
  shippingError: string | null
}

const idSchema = z.uuid()
const MS_PER_MIN = 60_000

/**
 * Cota o frete de um carrinho para um endereço do próprio cliente. O valor de cada opção vem da transportadora (Frenet) e
 * vai assinado no `quoteToken`, que o pedido confere: o app nunca manda o preço do frete. Entrega indisponível (desligada,
 * sem CEP de origem, sem token, Frenet fora do ar ou sem opções) NÃO é erro: volta `shippingError` e a retirada continua.
 */
export async function quoteShipping(ctx: TenantContext, i: { addressId: string; lines: RawCartLine[] }): Promise<ShippingQuote> {
  const customerId = await ownCustomerId(ctx)
  const settings = await loadStoreSettings(ctx)
  const cart = await priceCart(ctx, i.lines)
  const address = idSchema.safeParse(i.addressId).success ? await ctx.db.address.findFirst({ where: { id: i.addressId, customerId } }) : null
  if (address === null) throw new DomainError('not_found', 'Endereço não encontrado.')
  const pickup = { available: settings.pickupEnabled, instructions: settings.pickupEnabled ? settings.pickupInstructions : null }
  const error = settings.pickupEnabled ? 'A entrega não está disponível agora. Você pode retirar no local.' : 'A entrega não está disponível agora. Tente de novo em instantes.'
  // Voucher não entra no frete (nem no peso): carrinho só de vouchers não tem entrega a cotar.
  const physical = cart.lines.flatMap((l) => (l.kind === 'product' ? [l] : []))
  if (physical.length === 0) return { pickup: { available: false, instructions: null }, options: [], shippingError: 'Este carrinho só tem vouchers e não precisa de entrega.' }
  const none = (): ShippingQuote => ({ pickup, options: [], shippingError: error })

  const token = settings.shippingEnabled && settings.originPostalCode !== null ? await readFrenetToken(ctx.businessId) : null
  if (token === null || settings.originPostalCode === null) return none()

  let services
  try {
    services = await integrations().frenet.quote(token, {
      sellerCep: settings.originPostalCode,
      recipientCep: address.postalCode,
      invoiceValueCents: physical.reduce((sum, l) => sum + l.totalCents, 0),
      items: physical.map((l) => ({ sku: l.id, quantity: l.quantity, weightKg: l.weightGrams / 1000, lengthCm: l.lengthCm, heightCm: l.heightCm, widthCm: l.widthCm })),
    })
  } catch (err) {
    if (!(err instanceof IntegrationError)) throw err
    // Só o tipo da falha vai para o log: nada do cliente, do CEP nem do token.
    console.error(JSON.stringify({ level: 'warn', event: 'shipping_quote_failed', code: err.code }))
    return none()
  }
  if (services.length === 0) return none()

  const expiresAtMs = ctx.clock().getTime() + QUOTE_TTL_MIN * MS_PER_MIN
  const options = [...services]
    .sort((a, b) => a.priceCents - b.priceCents || a.days - b.days)
    .map((s) => ({
      serviceCode: s.serviceCode,
      name: s.name,
      carrier: s.carrier,
      priceCents: s.priceCents,
      days: s.days,
      quoteToken: signQuote({
        businessId: ctx.businessId,
        customerId,
        addressId: address.id,
        postalCode: address.postalCode,
        cartHash: cart.hash,
        serviceCode: s.serviceCode,
        serviceName: s.name,
        priceCents: s.priceCents,
        days: s.days,
        expiresAtMs,
      }),
    }))
  return { pickup, options, shippingError: null }
}
