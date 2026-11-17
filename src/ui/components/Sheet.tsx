'use client'
import type { ReactNode } from 'react'
import { Dialog } from './Dialog'
import { cx } from './cx'

/**
 * Folha de formulário: no celular sobe da base, no computador vira um painel que entra pela direita, com a página inteira
 * ainda visível por trás do fundo esmaecido. Mesmo comportamento do `Dialog` (foco preso, Esc e clique fora fecham,
 * o foco volta a quem abriu); muda só a forma. Use para criar e editar sem sair da lista.
 */
export function Sheet({
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
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={footer} className={cx('af-sheet', className)}>
      {children}
    </Dialog>
  )
}
