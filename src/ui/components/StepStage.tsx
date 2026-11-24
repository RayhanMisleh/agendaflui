'use client'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Palco de uma etapa (pergunta do quiz, passo do Agendar). Trocar `stepKey` remonta o conteúdo com a entrada deslizando 24 px
 * no sentido de `direction` (1 avança, -1 volta) e a leve escala; e leva o foco ao título da etapa nova, para quem usa teclado
 * ou leitor de tela saber que mudou. A primeira etapa não rouba o foco ao abrir a página.
 */
export function StepStage({ stepKey, direction, children }: { stepKey: string; direction: 1 | -1; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const anterior = useRef(stepKey)
  useEffect(() => {
    if (anterior.current === stepKey) return
    anterior.current = stepKey
    const titulo = ref.current?.querySelector<HTMLElement>('h1[tabindex="-1"], h2[tabindex="-1"]') ?? ref.current?.querySelector<HTMLElement>('h1, h2')
    if (!titulo) return
    if (titulo.getAttribute('tabindex') === null) titulo.setAttribute('tabindex', '-1')
    titulo.focus({ preventScroll: true })
  }, [stepKey])
  return (
    <div key={stepKey} ref={ref} className="af-cl-stage" data-direction={direction}>
      {children}
    </div>
  )
}
