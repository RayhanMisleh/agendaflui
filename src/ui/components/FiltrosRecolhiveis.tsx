'use client'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

/**
 * Filtros que recolhem no celular: o botão "Filtros" (com quantos estão aplicados) abre os campos, e o botão de enviar
 * fica ao lado dele. Do tablet para cima os campos ficam sempre à vista e o botão "Filtros" some (o CSS decide).
 */
export function FiltrosRecolhiveis({ ativos, filtros, enviar }: { ativos: number; filtros: ReactNode; enviar: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const corpo = useId()
  return (
    <div className="af-filtros" data-open={aberto ? '' : undefined}>
      <div className="af-filtros__bar">
        <button type="button" className="af-filtros__toggle" aria-expanded={aberto} aria-controls={corpo} onClick={() => setAberto((a) => !a)}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          Filtros
          {ativos > 0 ? (
            <span className="af-filtros__count">
              <span className="af-sr">, </span>
              {ativos} {ativos === 1 ? 'aplicado' : 'aplicados'}
            </span>
          ) : null}
          <ChevronDown size={16} aria-hidden="true" className="af-filtros__chevron" />
        </button>
        {enviar}
      </div>
      <div id={corpo} className="af-filtros__body">
        {filtros}
      </div>
    </div>
  )
}
