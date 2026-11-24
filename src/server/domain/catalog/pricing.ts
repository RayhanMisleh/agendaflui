import type { PriceVariant, PricingMode } from '@/server/db/generated/client'
import { isVariantVisible } from '@/server/niches'

export type VariantPriceRow = { variant: PriceVariant; priceCents: number; durationMin: number }
export type VariantPrice = { priceCents: number; durationMin: number }
export type PricedService = {
  pricingMode: PricingMode
  priceCents: number
  durationMin: number
  prices: readonly VariantPriceRow[]
}
export type Asker = 'customer' | 'staff'

/**
 * A regra única de "este serviço é feito para este animal?" (puro, sem banco).
 * Cliente com gato e gatos desligados nunca; `SINGLE` serve a todos; `BY_VARIANT` exige a linha da variante.
 */
export function isServiceOffered(
  s: Pick<PricedService, 'pricingMode' | 'prices'>,
  variant: PriceVariant | null,
  o: { who: Asker; servesCats: boolean },
): boolean {
  if (variant === 'CAT' && o.who === 'customer' && !o.servesCats) return false
  if (s.pricingMode === 'SINGLE') return true
  if (variant === null) return false
  return s.prices.some((p) => p.variant === variant)
}

/** `SINGLE` → o preço único; `BY_VARIANT` → a linha da variante ou `null`. */
export function priceFor(s: PricedService, variant: PriceVariant | null): VariantPrice | null {
  if (s.pricingMode === 'SINGLE') return { priceCents: s.priceCents, durationMin: s.durationMin }
  if (variant === null) return null
  const row = s.prices.find((p) => p.variant === variant)
  return row ? { priceCents: row.priceCents, durationMin: row.durationMin } : null
}

/** O "a partir de" que o cliente vê: só as linhas visíveis a ele entram. `null` quando não há nenhuma. */
export function fromPrice(s: PricedService, o: { servesCats: boolean }): { cents: number; varies: boolean } | null {
  if (s.pricingMode === 'SINGLE') return { cents: s.priceCents, varies: false }
  const visiveis = s.prices.filter((p) => isVariantVisible(p.variant, o))
  const primeiro = visiveis[0]
  if (primeiro === undefined) return null
  const precos = visiveis.map((p) => p.priceCents)
  const cents = Math.min(...precos)
  return { cents, varies: precos.some((c) => c !== primeiro.priceCents) }
}
