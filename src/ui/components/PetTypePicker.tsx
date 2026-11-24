'use client'
import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { PetSize, PetSpecies } from '@/server/db/generated/client'
import { PET_NICHE } from '@/server/niches/pet'
import { cx } from './cx'
import { PetIllustration } from './pet-illustrations'

export type PetTypeValue = { species: PetSpecies; size: PetSize | null }

type Opcao = { id: string; rotulo: string; detalhe: string | null; desenho: ReactNode }

const CAES = PET_NICHE.variants.filter((v) => v.species === 'DOG')
const GATO = PET_NICHE.variants.find((v) => v.species === 'CAT')

/** Grupo de cartões de escolha única: setas movem a seleção (e o foco), Tab entra e sai pelo escolhido. */
function Cartoes({ rotulo, opcoes, valor, onEscolher, className }: { rotulo: string; opcoes: readonly Opcao[]; valor: string | null; onEscolher: (id: string) => void; className?: string }) {
  const raiz = useRef<HTMLDivElement>(null)
  const ativo = opcoes.some((o) => o.id === valor) ? valor : (opcoes[0]?.id ?? null)

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (passo === 0 || opcoes.length === 0) return
    e.preventDefault()
    const i = Math.max(0, opcoes.findIndex((o) => o.id === ativo))
    const proximo = opcoes[(i + passo + opcoes.length) % opcoes.length]
    if (!proximo) return
    onEscolher(proximo.id)
    raiz.current?.querySelector<HTMLElement>(`[data-id="${proximo.id}"]`)?.focus()
  }

  return (
    <div ref={raiz} role="radiogroup" aria-label={rotulo} className={cx('af-pickgrid', className)} onKeyDown={aoTeclar}>
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          data-id={o.id}
          aria-checked={valor === o.id}
          tabIndex={ativo === o.id ? 0 : -1}
          className="af-pickcard"
          onClick={() => onEscolher(o.id)}
        >
          <span className="af-pickcard__art" aria-hidden="true">
            {o.desenho}
          </span>
          <span className="af-pickcard__label">{o.rotulo}</span>
          {o.detalhe ? <span className="af-pickcard__detail">{o.detalhe}</span> : null}
        </button>
      ))}
    </div>
  )
}

/**
 * Escolha de espécie e porte do pet em cartões com desenho. Gato só aparece quando a loja atende gatos ou quando quem
 * escolhe é a equipe (`staffMayPickCat`), que pode marcar mesmo com a opção desligada. Gato não tem porte: escolher gato
 * esconde os portes e limpa o porte. Escreve os campos escondidos `species` e `size` (o `size` só existe para cão com porte).
 * `name` só rotula o grupo para quem usa leitor de tela (por exemplo, o nome do pet).
 */
export function PetTypePicker({
  name,
  servesCats,
  staffMayPickCat,
  value,
  onChange,
}: {
  name?: string
  servesCats: boolean
  staffMayPickCat: boolean
  value: PetTypeValue
  onChange: (next: PetTypeValue) => void
}) {
  const gatoVisivel = GATO !== undefined && (servesCats || staffMayPickCat)
  const especies: Opcao[] = [
    { id: 'DOG', rotulo: 'Cão', detalhe: null, desenho: <PetIllustration variant="DOG_MEDIUM" size={44} /> },
    ...(gatoVisivel ? [{ id: 'CAT', rotulo: 'Gato', detalhe: null, desenho: <PetIllustration variant="CAT" size={44} /> }] : []),
  ]
  const portes: Opcao[] = CAES.map((v) => ({
    id: v.size ?? '',
    rotulo: v.shortLabel,
    detalhe: v.rangeLabel,
    desenho: <PetIllustration variant={v.key} size={44} />,
  }))
  const sufixo = name && name.trim() !== '' ? ` de ${name.trim()}` : ''

  return (
    <div className="af-pettype">
      <input type="hidden" name="species" value={value.species} />
      {value.species === 'DOG' && value.size !== null ? <input type="hidden" name="size" value={value.size} /> : null}
      <div className="af-pettype__group">
        <span className="af-field__label">
          Espécie
        </span>
        <Cartoes
          rotulo={`Espécie${sufixo}`}
          opcoes={especies}
          valor={value.species}
          className="af-pickgrid--duo"
          onEscolher={(id) => onChange(id === 'CAT' ? { species: 'CAT', size: null } : { species: 'DOG', size: value.size })}
        />
        {GATO !== undefined && !servesCats && staffMayPickCat ? (
          <p className="af-field__hint">A loja não atende gatos no momento. Só a equipe marca para gatos.</p>
        ) : null}
      </div>
      {value.species === 'DOG' ? (
        <div className="af-pettype__group">
          <span className="af-field__label">
            Porte
          </span>
          <Cartoes rotulo={`Porte${sufixo}`} opcoes={portes} valor={value.size} onEscolher={(id) => onChange({ species: 'DOG', size: id as PetSize })} />
        </div>
      ) : null}
    </div>
  )
}
