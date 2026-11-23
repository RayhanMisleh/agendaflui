'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from './cx'

const FOCAVEIS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'

/** Falso para o que não aparece: `display: none`, `visibility: hidden` e o conteúdo de um `details` fechado. */
function visivel(el: HTMLElement, dialog: HTMLElement): boolean {
  if (getComputedStyle(el).visibility === 'hidden') return false
  for (let a: HTMLElement | null = el; a && a !== dialog; a = a.parentElement) {
    if (getComputedStyle(a).display === 'none') return false
    const pai: HTMLElement | null = a.parentElement
    if (pai instanceof HTMLDetailsElement && !pai.open && a !== pai.querySelector(':scope > summary')) return false
  }
  return true
}

/** Num grupo de rádio só um item entra no anel: o marcado, ou o primeiro quando nenhum está marcado. */
function umPorGrupo(lista: HTMLElement[]): HTMLElement[] {
  const grupos = new Map<string, HTMLInputElement[]>()
  for (const el of lista) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || el.name === '') continue
    const chave = `${el.form ? 'f' : ''}${el.name}`
    grupos.set(chave, [...(grupos.get(chave) ?? []), el])
  }
  const fora = new Set<HTMLElement>()
  for (const radios of grupos.values()) {
    const escolhido = radios.find((r) => r.checked) ?? radios[0]
    for (const r of radios) if (r !== escolhido) fora.add(r)
  }
  return lista.filter((el) => !fora.has(el))
}

/** Elementos que o Tab alcança dentro do diálogo, na ordem do documento. */
function focaveis(dialog: HTMLElement): HTMLElement[] {
  const lista = Array.from(dialog.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
    (el) =>
      !el.matches(':disabled') &&
      el.getAttribute('tabindex') !== '-1' &&
      !el.closest('[hidden], [inert]') &&
      visivel(el, dialog),
  )
  return umPorGrupo(lista)
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
  // Ao fechar, o conteúdo fica montado até a saída animada acabar (o CSS dura no máximo 250 ms).
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setMounted(false), 250)
    return () => clearTimeout(t)
  }, [open])

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
      {open || mounted ? (
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
