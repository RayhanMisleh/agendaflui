import { Pergunta, type PassoProps } from './Pergunta'

const ANOS = Array.from({ length: 14 }, (_, i) => i + 1)

export function rotuloDaIdade(anos: number): string {
  if (anos <= 0) return 'Menos de 1 ano'
  if (anos >= 15) return '15 anos ou mais'
  return anos === 1 ? '1 ano' : `${anos} anos`
}

/** Idade em anos redondos. "Não sei" pula a pergunta (quem chama liga `onNaoSei` ao `skip`). */
export function Idade({ a, set, error, onNaoSei }: PassoProps & { onNaoSei: () => void }) {
  const opcoes: { valor: number; rotulo: string }[] = [
    { valor: 0, rotulo: 'Menos de 1 ano' },
    ...ANOS.map((n) => ({ valor: n, rotulo: String(n) })),
    { valor: 15, rotulo: '15 ou mais' },
  ]
  return (
    <Pergunta step="age" hint="Um palpite já ajuda." error={error}>
      <div className="af-cl-quiz__chips" role="radiogroup" aria-label="Idade em anos">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={a.ageYears === o.valor}
            className={`af-cl-chip${a.ageYears === o.valor ? ' is-selected' : ''}`}
            onClick={() => set({ ageYears: o.valor })}
          >
            {o.rotulo}
          </button>
        ))}
        <button type="button" className="af-cl-chip" onClick={onNaoSei}>
          Não sei
        </button>
      </div>
    </Pergunta>
  )
}
