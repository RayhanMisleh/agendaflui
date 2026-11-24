import * as React from 'react'
import type { ReactNode } from 'react'

// O Next traz o React com `ViewTransition`; o React estável dos testes (jsdom) não tem, e aí o conteúdo sai sem moldura.
const { ViewTransition }: Partial<Pick<typeof React, 'ViewTransition'>> = React

/**
 * Transição de página do painel: o miolo sai e entra com a classe `af-page` (ver `styles/motion.css`). Só navegação
 * anima (`default="none"`): atualizar a página depois de salvar não repete o movimento. Vai dentro de cada página, nunca
 * em volta da moldura: o layout persiste entre as rotas, e é por isso que a barra e o menu não piscam.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  if (!ViewTransition) return <>{children}</>
  return (
    <ViewTransition enter="af-page" exit="af-page" default="none">
      {children}
    </ViewTransition>
  )
}

/**
 * O esqueleto de uma tela (`loading.tsx`): ele só some com a mesma saída suave e não anima ao aparecer, para a página
 * nova chegar por cima dele sem um piscar no meio.
 */
export function SkeletonTransition({ children }: { children: ReactNode }) {
  if (!ViewTransition) return <>{children}</>
  return (
    <ViewTransition exit="af-page" default="none">
      {children}
    </ViewTransition>
  )
}
