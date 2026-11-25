'use client'
import { useEffect, useRef, useState } from 'react'
import { CalendarPlus, CalendarX2, Plus } from 'lucide-react'

/**
 * Botão redondo "+" da agenda no celular, ao alcance do polegar e acima da navegação. Com as duas opções (marcar e
 * bloquear) abre um menu curto; sem permissão de bloquear, o toque já abre a folha de marcar. No computador some: lá as
 * duas ações ficam na barra do topo.
 */
export function AgendaFab({ onMarcar, onBloquear }: { onMarcar: () => void; onBloquear?: (() => void) | undefined }) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => {
      if (raiz.current && e.target instanceof Node && !raiz.current.contains(e.target)) setAberto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        botao.current?.focus()
      }
    }
    document.addEventListener('pointerdown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  const escolher = (acao: () => void) => {
    setAberto(false)
    acao()
  }

  return (
    <div ref={raiz} className="af-fab" data-open={aberto ? '' : undefined}>
      {aberto && onBloquear ? (
        <div role="menu" aria-label="Novo horário" className="af-fab__menu">
          <button type="button" role="menuitem" className="af-fab__item" onClick={() => escolher(onMarcar)}>
            <CalendarPlus size={20} aria-hidden="true" />
            Marcar horário
          </button>
          <button type="button" role="menuitem" className="af-fab__item" onClick={() => escolher(onBloquear)}>
            <CalendarX2 size={20} aria-hidden="true" />
            Bloquear horário
          </button>
        </div>
      ) : null}
      <button
        ref={botao}
        type="button"
        className="af-fab__button"
        aria-label={onBloquear ? 'Novo horário' : 'Marcar horário'}
        {...(onBloquear ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': aberto } : {})}
        onClick={() => (onBloquear ? setAberto((a) => !a) : onMarcar())}
      >
        <Plus size={26} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  )
}
