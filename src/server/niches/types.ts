import type { z } from '@/server/domain/errors'
import type { Niche, PetCoat, PetSize, PetSpecies, PriceVariant } from '@/server/db/generated/client'
import type { ServiceIconName } from '@/shared/service-icons'

export type NicheKey = Niche
export type PetOptions = { servesCats: boolean }
export type VariantDef = {
  key: PriceVariant
  label: string
  shortLabel: string
  rangeLabel: string | null
  species: PetSpecies
  size: PetSize | null
  needsOption: 'servesCats' | null
}
export type QuizStepKey = 'name' | 'species' | 'size' | 'breed' | 'age' | 'coat' | 'care' | 'photo' | 'summary'
export type QuizStep = { key: QuizStepKey; title: string; optional: boolean; onlyIf: 'servesCats' | null }
export type VariantPrice = { priceCents: number; durationMin: number }
export type ServiceSuggestion = {
  name: string
  icon: ServiceIconName
  description: string
  prices: Record<PriceVariant, VariantPrice>
}
export type NicheDef = {
  key: NicheKey
  label: string
  subject: { singular: string; plural: string; add: string; empty: string }
  variants: readonly VariantDef[]
  optionsSchema: z.ZodType<PetOptions>
  defaultOptions: PetOptions
  quiz: readonly QuizStep[]
  careQuickOptions: readonly string[]
  breedSuggestions: Readonly<Record<PetSpecies, readonly string[]>>
  coatLabels: Readonly<Record<PetCoat, string>>
  serviceSuggestions: readonly ServiceSuggestion[]
}
