import { PET_NICHE } from '@/server/niches/pet'
import { Textarea } from '@/ui/components'
import { Pergunta, type PassoProps } from './Pergunta'

export function Cuidados({ a, set, error }: PassoProps) {
  function alternar(opcao: string) {
    set({ careChips: a.careChips.includes(opcao) ? a.careChips.filter((c) => c !== opcao) : [...a.careChips, opcao] })
  }
  return (
    <Pergunta step="care" hint="A equipe vê antes do atendimento." error={error}>
      <div className="af-cl-quiz__chips" role="group" aria-label="Cuidados rápidos">
        {PET_NICHE.careQuickOptions.map((o) => {
          const marcado = a.careChips.includes(o)
          return (
            <button key={o} type="button" aria-pressed={marcado} className={`af-cl-chip${marcado ? ' is-selected' : ''}`} onClick={() => alternar(o)}>
              {o}
            </button>
          )
        })}
      </div>
      <label className="af-field__label" htmlFor="quiz-cuidados">
        Conte mais, se quiser
      </label>
      <Textarea id="quiz-cuidados" name="careText" rows={3} maxLength={900} value={a.careText} onChange={(e) => set({ careText: e.target.value })} />
    </Pergunta>
  )
}
