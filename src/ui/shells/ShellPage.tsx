import type { ReactNode } from 'react'
import { PageTransition } from './PageTransition'

/**
 * A página dentro da moldura: título, ações à direita e o corpo. É a única parte que troca ao navegar, e a que leva a
 * transição (`PageTransition`); a barra, o menu e o topo ficam no layout e nunca animam.
 */
export function ShellPage({
  title,
  actions,
  headingLevel = 1,
  children,
}: {
  title: string
  actions?: ReactNode
  /** Na vitrine a moldura vem embutida em outra página, e o título é um `h2`. */
  headingLevel?: 1 | 2
  children: ReactNode
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h1'
  return (
    <PageTransition>
      <div className="af-shell__inner">
        <div className="af-shell__head">
          <Heading className="af-shell__title">{title}</Heading>
          {actions ? <div className="af-shell__actions">{actions}</div> : null}
        </div>
        <div className="af-shell__body">{children}</div>
      </div>
    </PageTransition>
  )
}
