'use client'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from './cx'

/**
 * Diálogo (no celular sobe da base como folha). `<dialog>` nativo com showModal(): o navegador cuida do foco preso e do fundo inerte.
 * Esc, clique fora e o botão Fechar chamam onClose; quem decide fechar é o dono do estado.
 */
export function Dialog({
  open,
  onClose,
  title,
  footer,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  footer?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedOnBackdrop = useRef(false)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const el = ref.current
    if (!el || !open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    if (!el.open) el.showModal()
    document.body.style.overflow = 'hidden'
    if (!el.contains(document.activeElement)) el.focus()
    return () => {
      if (el.open) el.close()
      document.body.style.overflow = previousOverflow
      if (trigger && trigger.isConnected) trigger.focus()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cx('af-dialog', className)}
      onCancel={(e) => {
        e.preventDefault()
        onCloseRef.current()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCloseRef.current()
        }
      }}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current) onCloseRef.current()
        pressedOnBackdrop.current = false
      }}
    >
      {open ? (
        <div className="af-dialog__sheet">
          <span className="af-dialog__grip" aria-hidden="true" />
          <header className="af-dialog__head">
            <h2 id={titleId} className="af-dialog__title">
              {title}
            </h2>
            <button type="button" className="af-dialog__close" aria-label="Fechar" onClick={() => onCloseRef.current()}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <div className="af-dialog__body">{children}</div>
          {footer ? <footer className="af-dialog__foot">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  )
}
