import { ChoiceCard, SpeciesIllustration } from '@/ui/components'
import { Pergunta, type PassoProps } from './Pergunta'

export function Especie({ a, set, error }: PassoProps) {
  return (
    <Pergunta step="species" error={error}>
      <div className="af-cl-quiz__grid af-cl-quiz__grid--duo" role="radiogroup" aria-label="Espécie">
        <ChoiceCard type="radio" name="species" value="DOG" checked={a.species === 'DOG'} onChange={() => set({ species: 'DOG' })} title="Cão" media={<SpeciesIllustration species="DOG" size={56} />} className="af-cl-quiz__choice" />
        <ChoiceCard type="radio" name="species" value="CAT" checked={a.species === 'CAT'} onChange={() => set({ species: 'CAT' })} title="Gato" media={<SpeciesIllustration species="CAT" size={56} />} className="af-cl-quiz__choice" />
      </div>
    </Pergunta>
  )
}
