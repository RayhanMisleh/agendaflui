import type { PetSize, PetSpecies, PriceVariant } from '@/server/db/generated/client'
import { PET_NICHE } from './pet'
import type { NicheDef, NicheKey, PetOptions, VariantDef } from './types'

export type { NicheDef, NicheKey, PetOptions, QuizStep, QuizStepKey, ServiceSuggestion, VariantDef, VariantPrice } from './types'

/** Registro dos nichos. Um nicho novo entra aqui e acrescenta o que for dele em `PriceVariant` na migração. */
export const NICHES: Readonly<Record<NicheKey, NicheDef>> = { PET: PET_NICHE }

export function nicheDef(key: NicheKey | null): NicheDef | null {
  return key === null ? null : NICHES[key]
}

/** Opções gravadas da conta. Ausente, inválido ou conta sem nicho: o padrão, sem lançar. */
export function parseNicheOptions(key: NicheKey | null, raw: unknown): PetOptions {
  const def = nicheDef(key)
  if (def === null) return { servesCats: false }
  const r = def.optionsSchema.safeParse(raw)
  return r.success ? r.data : def.defaultOptions
}

/** A variante de preço do pet. Cão sem porte é erro de programação (o banco já recusa). */
export function variantOfPet(p: { species: PetSpecies; size: PetSize | null }): PriceVariant {
  if (p.species === 'CAT') return 'CAT'
  switch (p.size) {
    case 'SMALL':
      return 'DOG_SMALL'
    case 'MEDIUM':
      return 'DOG_MEDIUM'
    case 'LARGE':
      return 'DOG_LARGE'
    case 'GIANT':
      return 'DOG_GIANT'
    default:
      throw new Error('Cão sem porte: a variante de preço não existe.')
  }
}

export function variantDef(v: PriceVariant): VariantDef {
  const d = PET_NICHE.variants.find((x) => x.key === v)
  if (!d) throw new Error(`Variante desconhecida: ${v}`)
  return d
}

export function isVariantVisible(v: PriceVariant, options: PetOptions): boolean {
  const need = variantDef(v).needsOption
  return need === null || options[need]
}

export function visibleVariants(def: NicheDef, options: PetOptions): readonly VariantDef[] {
  return def.variants.filter((v) => v.needsOption === null || options[v.needsOption])
}
