import type { PetCoat } from '@/server/db/generated/client'
import { PET_NICHE } from '@/server/niches/pet'
import { ChoiceCard } from '@/ui/components'
import { Pergunta, type PassoProps } from './Pergunta'

const PELAGENS = Object.entries(PET_NICHE.coatLabels) as [PetCoat, string][]

export function Pelagem({ a, set, error }: PassoProps) {
  return (
    <Pergunta step="coat" error={error}>
      <div className="af-cl-choices" role="radiogroup" aria-label="Pelagem">
        {PELAGENS.map(([chave, rotulo]) => (
          <ChoiceCard key={chave} type="radio" name="coat" value={chave} checked={a.coat === chave} onChange={() => set({ coat: chave })} title={rotulo} />
        ))}
      </div>
    </Pergunta>
  )
}
