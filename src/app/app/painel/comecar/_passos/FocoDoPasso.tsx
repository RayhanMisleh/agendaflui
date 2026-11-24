'use client'
import { useEffect, useRef } from 'react'

/** Leva o foco ao título do passo ao chegar nele, para quem usa teclado ou leitor de tela saber que mudou. */
export function FocoDoPasso({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-onb-title]')?.focus({ preventScroll: true })
  }, [])
  return (
    <div ref={ref} className="af-onb__stage">
      {children}
    </div>
  )
}
