'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { PageColumn, PageSlip } from '@/server/domain/scheduling/agenda-page'
import { dropTarget, labelOfMinute } from './drag-math'
import { PX_PER_MIN } from './metrics'

export type MoveTarget = { professionalId: string; startMin: number }

export type MovePreview = { slipId: string; professionalId: string; startMin: number; heightMin: number; label: string }

/** Quantos pixels o ponteiro precisa andar para um clique virar arrasto. */
const LIMIAR = 4
/** Falado pela região viva quando o movimento acaba sem enviar nada (Esc ou perda de foco). */
const CANCELADO = 'Movimento cancelado.'
const ENVIADO = 'Enviado para confirmar.'
/** Quanto tempo (ms) a ficha que acabou de ser enviada espera para recuperar o foco depois de trocar de coluna. */
const FOCO_ESPERA_MS = 8000

type Args = {
  columns: PageColumn[]
  windowStartMin: number
  windowEndMin: number
  step: number
  /** `true` para quem vê todas as agendas: pode soltar em outra coluna. Os demais só movem dentro da própria. */
  canCross: boolean
  onMove: ((slipId: string, target: MoveTarget) => void) | undefined
  /** O corpo de cada coluna (a área das fichas), por profissional. */
  bodies: RefObject<Map<string, HTMLElement>>
}

type Session = { slip: PageSlip; startX: number; startY: number; grab: number; started: boolean; cancelled: boolean; target: MoveTarget | null }

/**
 * Remarcar arrastando. Mouse e caneta: arrastar a ficha mostra a prévia encaixada na grade e, ao soltar, entrega o alvo a
 * `onMove` (quem chama confirma e grava). Teclado: as setas movem a ficha em foco um passo da grade (para cima e para
 * baixo) ou um profissional (para os lados), Enter entrega e Esc cancela. No toque não há arrastar: só a folha da ficha.
 * Nunca grava nada: quem decide conflito é o servidor.
 */
export function useDragReschedule(args: Args) {
  const latest = useRef(args)
  useEffect(() => {
    latest.current = args
  })
  const session = useRef<Session | null>(null)
  const suppress = useRef(false)
  const stop = useRef<(() => void) | null>(null)
  const [preview, setPreview] = useState<MovePreview | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const enabled = args.onMove !== undefined

  const alvoDe = useCallback((s: Session, x: number, y: number): MoveTarget | null => {
    const a = latest.current
    const permitidas = a.canCross ? a.columns : a.columns.filter((c) => c.id === s.slip.professionalId)
    const rects = permitidas.map((c) => a.bodies.current.get(c.id)?.getBoundingClientRect() ?? { left: 0, right: 0, top: 0, bottom: 0 })
    const alvo = dropTarget({ x, y: y - s.grab }, rects, a.windowStartMin, PX_PER_MIN, a.step)
    const coluna = alvo ? permitidas[alvo.professionalIndex] : undefined
    if (!alvo || !coluna) return null
    return { professionalId: coluna.id, startMin: Math.min(alvo.startMin, a.windowEndMin - s.slip.box.heightMin) }
  }, [])

  const limpar = useCallback(() => {
    stop.current?.()
    stop.current = null
    session.current = null
    setPreview(null)
  }, [])

  useEffect(() => limpar, [limpar])

  const origem = (slip: PageSlip): MoveTarget => ({ professionalId: slip.professionalId, startMin: latest.current.windowStartMin + slip.box.topMin })
  const igual = (a: MoveTarget, b: MoveTarget) => a.professionalId === b.professionalId && a.startMin === b.startMin

  const aoPressionar = useCallback(
    (slip: PageSlip, e: ReactPointerEvent<HTMLElement>) => {
      if (!latest.current.onMove || !slip.draggable || e.pointerType === 'touch' || e.button !== 0) return
      limpar()
      const rect = e.currentTarget.getBoundingClientRect()
      const s: Session = { slip, startX: e.clientX, startY: e.clientY, grab: e.clientY - rect.top, started: false, cancelled: false, target: null }
      session.current = s

      const mover = (ev: PointerEvent) => {
        if (s.cancelled) return
        if (!s.started && Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < LIMIAR) return
        s.started = true
        s.target = alvoDe(s, ev.clientX, ev.clientY)
        setPreview(s.target ? { slipId: slip.id, ...s.target, heightMin: slip.box.heightMin, label: labelOfMinute(s.target.startMin) } : null)
      }
      const soltar = (ev: PointerEvent) => {
        const alvo = s.started && !s.cancelled ? alvoDe(s, ev.clientX, ev.clientY) : null
        const arrastou = s.started
        limpar()
        if (arrastou) {
          suppress.current = true
          setTimeout(() => {
            suppress.current = false
          }, 0)
        }
        if (alvo && !igual(alvo, origem(slip))) latest.current.onMove?.(slip.id, alvo)
      }
      const teclar = (ev: KeyboardEvent | globalThis.KeyboardEvent) => {
        if (ev.key !== 'Escape') return
        s.cancelled = true
        setPreview(null)
        setAnnouncement(CANCELADO)
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', soltar)
      window.addEventListener('pointercancel', soltar)
      window.addEventListener('keydown', teclar)
      stop.current = () => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', soltar)
        window.removeEventListener('pointercancel', soltar)
        window.removeEventListener('keydown', teclar)
      }
    },
    [alvoDe, limpar],
  )

  const teclado = useRef<MovePreview | null>(null)
  const fixarTeclado = (p: MovePreview | null, nome?: string, fala = '') => {
    teclado.current = p
    setPreview(p)
    setAnnouncement(p ? `Mover para ${p.label}${nome ? ` com ${nome}` : ''}. Enter confirma, Esc cancela.` : fala)
  }

  // A ficha enviada pelo teclado pode trocar de coluna: o React a remonta e o foco cairia no corpo da página. Guardamos
  // qual era para devolver o foco quando ela reaparecer (e só se ninguém mais o tiver pegado nem houver diálogo aberto).
  const foco = useRef<{ id: string; ate: number } | null>(null)
  const restoreFocus = useCallback(() => {
    const f = foco.current
    if (!f) return
    if (performance.now() > f.ate) {
      foco.current = null
      return
    }
    if (document.querySelector('dialog[open]')) return
    const ativo = document.activeElement
    const alvo = Array.from(document.querySelectorAll<HTMLElement>('[data-slip]')).find((el) => el.dataset.slip === f.id)
    if (ativo && ativo !== document.body && ativo !== alvo) {
      foco.current = null
      return
    }
    if (ativo === document.body || ativo === null) {
      if (alvo) {
        alvo.focus()
        foco.current = null
      }
    }
  }, [])

  const aoTeclar = useCallback((slip: PageSlip, e: KeyboardEvent<HTMLElement>) => {
    const a = latest.current
    if (!a.onMove || !slip.draggable) return
    const atual = teclado.current?.slipId === slip.id ? teclado.current : null
    if (e.key === 'Escape' && atual) {
      e.preventDefault()
      e.stopPropagation()
      fixarTeclado(null, undefined, CANCELADO)
      return
    }
    if (e.key === 'Enter' && atual) {
      e.preventDefault()
      const alvo = { professionalId: atual.professionalId, startMin: atual.startMin }
      const mudou = !igual(alvo, origem(slip))
      fixarTeclado(null, undefined, mudou ? ENVIADO : CANCELADO)
      if (mudou) {
        foco.current = { id: slip.id, ate: performance.now() + FOCO_ESPERA_MS }
        a.onMove(slip.id, alvo)
      }
      return
    }
    const base = atual ?? { slipId: slip.id, ...origem(slip), heightMin: slip.box.heightMin, label: '' }
    let { professionalId, startMin } = base
    if (e.key === 'ArrowDown') startMin += a.step
    else if (e.key === 'ArrowUp') startMin -= a.step
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!a.canCross) return
      const i = a.columns.findIndex((c) => c.id === professionalId)
      const vizinha = a.columns[i + (e.key === 'ArrowRight' ? 1 : -1)]
      if (vizinha) professionalId = vizinha.id
    } else return
    e.preventDefault()
    startMin = Math.min(a.windowEndMin - slip.box.heightMin, Math.max(a.windowStartMin, startMin))
    fixarTeclado(
      { slipId: slip.id, professionalId, startMin, heightMin: slip.box.heightMin, label: labelOfMinute(startMin) },
      a.columns.find((c) => c.id === professionalId)?.name,
    )
  }, [])

  const bind = (slip: PageSlip) => ({
    draggable: enabled && slip.draggable,
    lifted: preview?.slipId === slip.id,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => aoPressionar(slip, e),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => aoTeclar(slip, e),
    onBlur: () => {
      if (teclado.current?.slipId === slip.id) fixarTeclado(null, undefined, CANCELADO)
    },
    /** Depois de um arrasto o clique que o navegador solta junto não abre a ficha. */
    consumeClick: () => suppress.current,
  })

  return { preview, announcement, bind, restoreFocus }
}
