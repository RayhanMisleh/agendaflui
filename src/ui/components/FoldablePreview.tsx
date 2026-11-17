'use client'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from './cx'
import { useHydrated } from './use-hydrated'

/**
 * Lado da prévia ao vivo. No computador ela fica fixa ao lado do formulário. No celular vira um cartão recolhível acima
 * do formulário: o botão esconde e mostra o conteúdo (que continua no HTML; o CSS o esconde). Sem JavaScript fica sempre aberta.
 */
export function FoldablePreview({ children, label = 'Prévia ao vivo da marca', className }: { children: ReactNode; label?: string; className?: string }) {
  const hydrated = useHydrated()
  const [open, setOpen] = useState(true)
  const id = useId()
  return (
    <aside aria-label={label} className={cx('af-foldable', className)} data-js={hydrated ? 'true' : 'false'} data-open={open ? 'true' : 'false'}>
      <button type="button" className="af-foldable__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>{open ? 'Esconder a prévia' : 'Mostrar a prévia'}</span>
        <ChevronDown className="af-foldable__chevron" size={18} aria-hidden="true" />
      </button>
      <div id={id} className="af-foldable__body">
        {children}
      </div>
    </aside>
  )
}
