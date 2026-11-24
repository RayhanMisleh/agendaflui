'use client'
import { useRef, type KeyboardEvent } from 'react'
import { cx } from './cx'

export type DayStripDay = { date: string; label: string; weekdayShort: string; available: boolean }

/**
 * Faixa de dias do Agendar: rolagem horizontal com encaixe, um grupo de opções (`radiogroup`). Dia sem horário fica
 * esmaecido e não se escolhe ("Sem horário" no nome acessível). As setas movem a escolha para o dia livre vizinho.
 */
export function DayStrip(p: {
  days: DayStripDay[]
  value: string | null
  onChange: (date: string) => void
  onMore?: () => void
  moreLoading?: boolean
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const livres = p.days.filter((d) => d.available)
  // Quem recebe o foco ao chegar com a tecla Tab: o escolhido, senão o primeiro dia livre.
  const entrada = p.value !== null && livres.some((d) => d.date === p.value) ? p.value : (livres[0]?.date ?? null)

  const mover = (e: KeyboardEvent, passo: 1 | -1) => {
    const i = livres.findIndex((d) => d.date === (p.value ?? entrada))
    const alvo = livres[i === -1 ? 0 : i + passo]
    if (!alvo) return
    e.preventDefault()
    p.onChange(alvo.date)
    refs.current.get(alvo.date)?.focus()
  }

  return (
    <div className="af-cl-days">
      <div
        className="af-cl-days__strip"
        role="radiogroup"
        aria-label="Dia"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') mover(e, 1)
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') mover(e, -1)
        }}
      >
        {p.days.map((d) => {
          const marcado = d.date === p.value
          return (
            <button
              key={d.date}
              ref={(el) => {
                if (el) refs.current.set(d.date, el)
                else refs.current.delete(d.date)
              }}
              type="button"
              role="radio"
              aria-checked={marcado}
              aria-disabled={!d.available || undefined}
              aria-label={`${d.weekdayShort} ${d.label}${d.available ? '' : ', sem horário'}`}
              tabIndex={d.date === entrada ? 0 : -1}
              className={cx('af-cl-day', marcado && 'is-selected', !d.available && 'is-off')}
              onClick={() => {
                if (d.available) p.onChange(d.date)
              }}
            >
              <span className="af-cl-day__week">{d.weekdayShort}</span>
              <span className="af-cl-day__num">{d.label}</span>
            </button>
          )
        })}
        {p.onMore ? (
          <button type="button" className="af-cl-day af-cl-day--more" onClick={p.onMore} disabled={p.moreLoading} aria-busy={p.moreLoading || undefined}>
            <span className="af-cl-day__num">{p.moreLoading ? '…' : '+'}</span>
            <span className="af-cl-day__week">Mais dias</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
