'use client'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

const DURACAO_MS = 200
const CURVA = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * Palco do cartão de entrada: acompanha a altura do conteúdo e a anima, para que trocar de tela (Entrar, Criar conta, um
 * passo do quiz) mude o cartão sem salto. A altura é animada pela Web Animations API (200 ms, e nada com `prefers-reduced-motion:
 * reduce`), não por CSS: a regra do CSS do projeto é só `transform` e `opacity`. A primeira medida não anima (a página já nasce
 * na altura certa); sem `ResizeObserver` (testes, navegador antigo) o palco só cresce com o conteúdo.
 */
export function EntryStage({ children }: { children: ReactNode }) {
  const palco = useRef<HTMLDivElement>(null)
  const interno = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const caixa = palco.current
    const el = interno.current
    if (!caixa || !el || typeof ResizeObserver === 'undefined') return
    let animacao: Animation | null = null
    let primeira = true
    const observador = new ResizeObserver(() => {
      const nova = el.offsetHeight
      // Lida antes de mudar: no meio de uma animação, é a altura que a pessoa está vendo.
      const atual = caixa.getBoundingClientRect().height
      caixa.style.height = `${nova}px`
      if (primeira) {
        primeira = false
        return
      }
      if (typeof caixa.animate !== 'function' || Math.abs(atual - nova) < 1) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      animacao?.cancel()
      animacao = caixa.animate([{ height: `${atual}px` }, { height: `${nova}px` }], { duration: DURACAO_MS, easing: CURVA })
    })
    observador.observe(el)
    return () => {
      animacao?.cancel()
      observador.disconnect()
    }
  }, [])

  return (
    <div ref={palco} className="af-entry__stage">
      <div ref={interno} className="af-entry__inner">
        {children}
      </div>
    </div>
  )
}
