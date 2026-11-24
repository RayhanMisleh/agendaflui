'use client'
import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Input } from '@/ui/components'
import { breedMatches } from '../quiz'
import { Pergunta, type PassoProps } from './Pergunta'

/** Busca de raça: lista abaixo do campo (setas e Enter), "Sem raça definida" sempre à vista e texto livre aceito. */
export function Raca({ a, set, error }: PassoProps) {
  const uid = useId()
  const listaId = `${uid}-lista`
  const texto = a.breed ?? ''
  const opcoes = breedMatches(texto, a.species)
  const [ativa, setAtiva] = useState(-1)

  function escolher(raca: string) {
    set({ breed: raca })
    setAtiva(-1)
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setAtiva((i) => (i + passo + opcoes.length) % opcoes.length)
    } else if (e.key === 'Enter' && ativa >= 0) {
      // Enter numa opção escolhe; sem opção marcada, deixa o formulário avançar com o texto livre.
      e.preventDefault()
      const raca = opcoes[ativa]
      if (raca) escolher(raca)
    } else if (e.key === 'Escape') {
      setAtiva(-1)
    }
  }

  return (
    <Pergunta step="breed" hint="Escolha da lista ou escreva." error={error}>
      <Input
        name="breed"
        aria-label="Raça"
        role="combobox"
        aria-expanded="true"
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={ativa >= 0 ? `${uid}-op-${ativa}` : undefined}
        value={texto}
        onChange={(e) => {
          set({ breed: e.target.value })
          setAtiva(-1)
        }}
        onKeyDown={aoTeclar}
        maxLength={60}
        autoComplete="off"
        enterKeyHint="next"
      />
      <ul id={listaId} role="listbox" aria-label="Sugestões de raça" className="af-cl-quiz__breeds">
        {opcoes.map((raca, i) => (
          <li
            key={raca}
            id={`${uid}-op-${i}`}
            role="option"
            aria-selected={texto === raca}
            className={`af-cl-quiz__breed${i === ativa ? ' is-active' : ''}${texto === raca ? ' is-selected' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => escolher(raca)}
          >
            {raca}
          </li>
        ))}
      </ul>
    </Pergunta>
  )
}
