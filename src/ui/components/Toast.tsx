'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from './cx'
import type { StateTone } from './StatusDot'

export type ToastInput = { tone?: StateTone; message: string }
type Item = { id: number; tone: StateTone; message: string }

/** O tom dito em palavras, só para o leitor de tela: o ponto colorido não é a única pista. */
const TONE_TEXT: Record<StateTone, string> = { success: 'Sucesso:', warning: 'Atenção:', danger: 'Erro:', neutral: 'Aviso:' }

/** Aviso flutuante: cartão com sombra e o ponto do tom à esquerda. Normalmente você usa `useToast()`; este é o cartão em si. */
export function Toast({
  tone = 'neutral',
  message,
  onClose,
  className,
}: {
  tone?: StateTone
  message: string
  onClose?: () => void
  className?: string
}) {
  return (
    <div className={cx('af-toast', `af-toast--${tone}`, className)}>
      <span className="af-toast__dot" aria-hidden="true" />
      <p className="af-toast__message">
        <span className="af-sr">{TONE_TEXT[tone]}</span> {message}
      </p>
      {onClose ? (
        <button type="button" className="af-toast__close" aria-label="Dispensar aviso" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

function TimedToast({ item, onDone }: { item: Item; onDone: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDone(item.id), item.tone === 'danger' ? 9000 : 5000)
    return () => clearTimeout(t)
  }, [item.id, item.tone, onDone])
  return <Toast tone={item.tone} message={item.message} onClose={() => onDone(item.id)} />
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null)

/** Coloque uma vez perto da raiz. Os avisos entram no canto da tela, numa região viva só. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const seq = useRef(0)
  const region = useRef<HTMLDivElement>(null)
  // Na camada superior (popover) o aviso aparece também acima de um <dialog> aberto.
  // Reabrir a cada aviso novo o leva para o topo da pilha.
  const count = items.length
  useEffect(() => {
    const el = region.current
    if (!el || typeof el.showPopover !== 'function') return
    if (el.matches(':popover-open')) el.hidePopover()
    el.showPopover()
  }, [count])
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((i) => i.id !== id)), [])
  const toast = useCallback(({ tone = 'neutral', message }: ToastInput) => {
    seq.current += 1
    const id = seq.current
    setItems((l) => [...l.slice(-3), { id, tone, message }])
  }, [])
  return (
    <ToastContext value={toast}>
      {children}
      <div ref={region} popover="manual" className="af-toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <TimedToast key={item.id} item={item} onDone={dismiss} />
        ))}
      </div>
    </ToastContext>
  )
}

export function useToast(): (t: ToastInput) => void {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast precisa estar dentro de ToastProvider.')
  return toast
}
