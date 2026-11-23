import * as React from 'react'
import type { ReactNode } from 'react'

// O Next traz o React com `ViewTransition`; o React estável dos testes (jsdom) não tem, e aí o conteúdo sai sem moldura.
const { ViewTransition }: Partial<Pick<typeof React, 'ViewTransition'>> = React

/**
 * Transição de página do painel: o conteúdo principal sai e entra com a classe `af-page` (ver `styles/motion.css`).
 * Só navegação anima (`default="none"`): atualizar a página depois de salvar não repete o movimento. A barra lateral
 * fica fora e não anima. A moldura mora em cada página, por isso o enter e o exit disparam a cada rota nova.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  if (!ViewTransition) return <>{children}</>
  return (
    <ViewTransition enter="af-page" exit="af-page" default="none">
      {children}
    </ViewTransition>
  )
}
