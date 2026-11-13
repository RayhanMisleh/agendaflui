'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { cx } from './cx'
import type { Tone } from './Stamp'

export type ToastInput = { tone?: Tone; message: string }
type Item = { id: number; tone: Tone; message: string }

const ICONS = { ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert, neutral: Info } as const

/** Um bilhete. Normalmente você usa `useToast()`; este é o objeto em si. */
export function Toast({
  tone = 'neutral',
  message,
  onClose,
  className,
}: {
  tone?: Tone
  message: string
  onClose?: () => void
  className?: string
}) {
  const Icon = ICONS[tone]
  return (
    <div className={cx('af-toast', `af-toast--${tone}`, className)}>
      <span className="af-toast__stub" aria-hidden="true">
        <Icon size={20} />
      </span>
      <p className="af-toast__message">{message}</p>
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
    const t = setTimeout(() => onDone(item.id), item.tone === 'bad' ? 9000 : 5000)
    return () => clearTimeout(t)
  }, [item.id, item.tone, onDone])
  return <Toast tone={item.tone} message={item.message} onClose={() => onDone(item.id)} />
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null)

/** Coloque uma vez perto da raiz. Os bilhetes entram no canto da tela. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const seq = useRef(0)
  const region = useRef<HTMLDivElement>(null)
  // Na camada superior (popover) o bilhete aparece também acima de um <dialog> aberto.
  // Reabrir a cada bilhete novo o leva para o topo da pilha.
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
