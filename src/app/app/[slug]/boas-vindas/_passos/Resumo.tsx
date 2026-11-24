import { PET_NICHE } from '@/server/niches/pet'
import { variantDef, variantOfPet } from '@/server/niches'
import { CalendarPlus, Plus } from 'lucide-react'
import { Button } from '@/ui/components'
import { careNotesOf, type QuizAnswers, type QuizStepKey } from '../quiz'
import { rotuloDaIdade } from './Idade'
import { Pergunta } from './Pergunta'

type Linha = { chave: QuizStepKey; rotulo: string; valor: string | null }

/** As respostas em linhas ("Nome: Thor") só com os passos que existem nesta loja. */
export function linhasDoResumo(a: QuizAnswers, steps: readonly QuizStepKey[]): Linha[] {
  const tipo = a.species === 'CAT' || a.size ? variantDef(variantOfPet({ species: a.species, size: a.size })) : null
  const todas: Linha[] = [
    { chave: 'name', rotulo: 'Nome', valor: a.name.trim() || null },
    { chave: 'species', rotulo: 'Espécie', valor: a.species === 'CAT' ? 'Gato' : 'Cão' },
    { chave: 'size', rotulo: 'Porte', valor: tipo ? (tipo.rangeLabel ? `${tipo.shortLabel}, ${tipo.rangeLabel}` : tipo.shortLabel) : null },
    { chave: 'breed', rotulo: 'Raça', valor: a.breed?.trim() || null },
    { chave: 'age', rotulo: 'Idade', valor: a.ageYears === null ? null : rotuloDaIdade(a.ageYears) },
    { chave: 'coat', rotulo: 'Pelagem', valor: a.coat ? PET_NICHE.coatLabels[a.coat] : null },
    { chave: 'care', rotulo: 'Cuidados', valor: careNotesOf(a) },
    { chave: 'photo', rotulo: 'Foto', valor: a.photo ? a.photo.name : null },
  ]
  return todas.filter((l) => steps.includes(l.chave))
}

export function Resumo({
  a,
  steps,
  error,
  onMudar,
  onSalvar,
  salvando,
}: {
  a: QuizAnswers
  steps: readonly QuizStepKey[]
  error: string | null
  onMudar: (step: QuizStepKey) => void
  onSalvar: (then: 'agendar' | 'outro') => void
  salvando: 'agendar' | 'outro' | null
}) {
  return (
    <Pergunta step="summary" error={error}>
      <dl className="af-cl-quiz__summary">
        {linhasDoResumo(a, steps).map((l) => (
          <div key={l.chave} className="af-cl-quiz__row">
            <dt>{l.rotulo}</dt>
            <dd className={l.valor ? undefined : 'is-empty'}>{l.valor ?? 'Não informado'}</dd>
            <button type="button" className="af-cl-quiz__change" aria-label={`Mudar ${l.rotulo.toLowerCase()}`} onClick={() => onMudar(l.chave)}>
              Mudar
            </button>
          </div>
        ))}
      </dl>
      <div className="af-cl-quiz__final">
        <Button variant="primary" size="lg" icon={<CalendarPlus size={18} />} loading={salvando === 'agendar'} disabled={salvando !== null} onClick={() => onSalvar('agendar')}>
          Agendar agora
        </Button>
        <Button variant="secondary" size="lg" icon={<Plus size={18} />} loading={salvando === 'outro'} disabled={salvando !== null} onClick={() => onSalvar('outro')}>
          Adicionar outro pet
        </Button>
      </div>
    </Pergunta>
  )
}
