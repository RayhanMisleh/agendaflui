'use client'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from './cx'

const FOCAVEIS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'

/** Elementos que o Tab alcança dentro do diálogo, na ordem do documento. */
function focaveis(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1' && !el.closest('[hidden], [inert]'),
  )
}

/**
 * Diálogo (no celular sobe da base como folha). `<dialog>` nativo com showModal(): o navegador cuida do fundo inerte; o
 * Tab também é fechado em anel aqui, para o foco nunca sair em nenhum navegador.
 * Esc, clique fora e o botão Fechar chamam onClose; quem decide fechar é o dono do estado. Um Esc que um filho já tratou
 * (lista aberta, campo de busca) não fecha o diálogo.
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
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          onCloseRef.current()
        }
        if (e.key === 'Tab' && !e.defaultPrevented) {
          const lista = focaveis(e.currentTarget)
          const primeiro = lista[0]
          const ultimo = lista[lista.length - 1]
          if (!primeiro || !ultimo) {
            e.preventDefault()
            return
          }
          const ativo = document.activeElement
          const dentro = ativo instanceof HTMLElement && lista.includes(ativo)
          if (e.shiftKey && (!dentro || ativo === primeiro)) {
            e.preventDefault()
            ultimo.focus()
          } else if (!e.shiftKey && (!dentro || ativo === ultimo)) {
            e.preventDefault()
            primeiro.focus()
          }
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
