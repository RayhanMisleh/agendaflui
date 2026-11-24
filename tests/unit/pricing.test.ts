import { describe, expect, test } from 'vitest'
import type { PriceVariant } from '@/server/db/generated/client'
import { fromPrice, isServiceOffered, priceFor, type PricedService } from '@/server/domain/catalog/pricing'

const single: PricedService = { pricingMode: 'SINGLE', priceCents: 5000, durationMin: 60, prices: [] }
const porPorte: PricedService = {
  pricingMode: 'BY_VARIANT',
  priceCents: 5000,
  durationMin: 60,
  prices: [
    { variant: 'DOG_SMALL', priceCents: 5000, durationMin: 60 },
    { variant: 'CAT', priceCents: 7000, durationMin: 60 },
  ],
}

describe('isServiceOffered', () => {
  test.each<[PricedService, PriceVariant | null, 'customer' | 'staff', boolean, boolean]>([
    [single, 'DOG_GIANT', 'customer', false, true],
    [single, 'CAT', 'customer', false, false],
    [single, 'CAT', 'staff', false, true],
    [single, 'CAT', 'customer', true, true],
    [porPorte, 'DOG_SMALL', 'customer', false, true],
    [porPorte, 'DOG_LARGE', 'staff', true, false],
    [porPorte, 'CAT', 'customer', false, false],
    [porPorte, 'CAT', 'staff', false, true],
    [{ ...porPorte, prices: porPorte.prices.slice(0, 1) }, 'CAT', 'staff', true, false],
    [porPorte, null, 'staff', true, false],
    [single, null, 'customer', false, true],
  ])('caso %#', (s, v, who, servesCats, esperado) => {
    expect(isServiceOffered(s, v, { who, servesCats })).toBe(esperado)
  })
})

describe('priceFor', () => {
  test('SINGLE devolve o único; BY_VARIANT devolve a linha ou null', () => {
    expect(priceFor(single, 'DOG_GIANT')).toEqual({ priceCents: 5000, durationMin: 60 })
    expect(priceFor(single, null)).toEqual({ priceCents: 5000, durationMin: 60 })
    expect(priceFor(porPorte, 'CAT')).toEqual({ priceCents: 7000, durationMin: 60 })
    expect(priceFor(porPorte, 'DOG_LARGE')).toBeNull()
    expect(priceFor(porPorte, null)).toBeNull()
  })
})

describe('fromPrice', () => {
  test('SINGLE: preço único, sem variação', () => {
    expect(fromPrice(single, { servesCats: false })).toEqual({ cents: 5000, varies: false })
  })

  test('gato escondido não entra no "a partir de"', () => {
    const s: PricedService = {
      ...porPorte,
      prices: [
        { variant: 'DOG_SMALL', priceCents: 5000, durationMin: 60 },
        { variant: 'CAT', priceCents: 3000, durationMin: 60 },
      ],
    }
    expect(fromPrice(s, { servesCats: false })).toEqual({ cents: 5000, varies: false })
    expect(fromPrice(s, { servesCats: true })).toEqual({ cents: 3000, varies: true })
  })

  test('só linha de gato e gatos desligados → null', () => {
    expect(fromPrice({ ...porPorte, prices: porPorte.prices.slice(1) }, { servesCats: false })).toBeNull()
  })

  test('preços iguais → varies false; diferentes → menor e varies true', () => {
    const iguais: PricedService = {
      ...porPorte,
      prices: [
        { variant: 'DOG_SMALL', priceCents: 4000, durationMin: 30 },
        { variant: 'DOG_MEDIUM', priceCents: 4000, durationMin: 30 },
      ],
    }
    expect(fromPrice(iguais, { servesCats: false })).toEqual({ cents: 4000, varies: false })
    const difere: PricedService = { ...iguais, prices: [...iguais.prices, { variant: 'DOG_LARGE', priceCents: 6000, durationMin: 60 }] }
    expect(fromPrice(difere, { servesCats: false })).toEqual({ cents: 4000, varies: true })
  })
})
