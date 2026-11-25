import type { PetSize } from '@/server/db/generated/client'
import { PET_NICHE } from '@/server/niches/pet'
import { ChoiceCard, PetIllustration } from '@/ui/components'
import { Pergunta, type PassoProps } from './Pergunta'

const PORTES = PET_NICHE.variants.filter((v) => v.species === 'DOG')

export function Porte({ a, set, error }: PassoProps) {
  return (
    <Pergunta step="size" hint="Pelo peso de hoje, mais ou menos." error={error}>
      <div className="af-cl-quiz__grid" role="radiogroup" aria-label="Porte">
        {PORTES.map((v) => (
          <ChoiceCard
            key={v.key}
            type="radio"
            name="size"
            value={v.size ?? ''}
            checked={a.size === v.size}
            onChange={(valor) => set({ size: valor as PetSize })}
            title={v.shortLabel}
            {...(v.rangeLabel ? { detail: v.rangeLabel } : {})}
            media={<PetIllustration variant={v.key} size={52} />}
            className="af-cl-quiz__choice af-cl-quiz__choice--stack"
          />
        ))}
      </div>
    </Pergunta>
  )
}
