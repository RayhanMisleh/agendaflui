import type { CSSProperties } from 'react'

export type ShellSkeletonVariant = 'dashboard' | 'list' | 'detail' | 'planner'

function Bloco({ w, h, className }: { w?: string; h?: string; className?: string }) {
  const style = { '--w': w, '--h': h } as CSSProperties
  return <span aria-hidden="true" className={`af-skel${className ? ` ${className}` : ''}`} style={style} />
}

function Linhas({ n }: { n: number }) {
  return (
    <div className="af-shellskel__card">
      {Array.from({ length: n }, (_, i) => (
        <Bloco key={i} w={i === n - 1 ? '58%' : i % 2 ? '92%' : '100%'} />
      ))}
    </div>
  )
}

function Corpo({ variant }: { variant: ShellSkeletonVariant }) {
  switch (variant) {
    case 'dashboard':
      return (
        <>
          <div className="af-shellskel__stats">
            <Bloco h="5.5rem" className="af-skel--card" />
            <Bloco h="5.5rem" className="af-skel--card" />
            <Bloco h="5.5rem" className="af-skel--card" />
          </div>
          <div className="af-shellskel__pair">
            <Linhas n={5} />
            <Linhas n={4} />
          </div>
        </>
      )
    case 'list':
      return (
        <>
          <Bloco w="min(24rem, 100%)" h="2.75rem" className="af-skel--field" />
          <div className="af-shellskel__card">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="af-shellskel__row">
                <Bloco w="2.5rem" h="2.5rem" className="af-skel--round" />
                <div className="af-shellskel__grow">
                  <Bloco w="55%" />
                  <Bloco w="35%" />
                </div>
              </div>
            ))}
          </div>
        </>
      )
    case 'detail':
      return (
        <div className="af-shellskel__pair">
          <Linhas n={6} />
          <Linhas n={4} />
        </div>
      )
    case 'planner':
      return (
        <>
          <div className="af-shellskel__tools">
            <Bloco w="9rem" h="2.75rem" className="af-skel--field" />
            <Bloco w="6rem" h="2.75rem" className="af-skel--field" />
          </div>
          <Bloco h="min(28rem, 60dvh)" className="af-skel--card" />
        </>
      )
  }
}

/**
 * Esqueleto de uma tela inteira: a mesma grade da moldura (barra lateral na cor `--side-bg` do tema em volta e área
 * principal sobre `--ground`), com blocos que pulsam no lugar do conteúdo. Cada `loading.tsx` escolhe a forma da sua tela.
 */
export function ShellSkeleton({ variant }: { variant: ShellSkeletonVariant }) {
  return (
    <div role="status" aria-busy="true" aria-label="Carregando" className="af-shell af-shell--skeleton">
      <div className="af-shell__frame">
        <div className="af-shell__side">
          <div className="af-shell__top">
            <Bloco w="7.5rem" h="1.5rem" className="af-skel--side" />
          </div>
          <div className="af-shellskel__nav">
            {Array.from({ length: 5 }, (_, i) => (
              <Bloco key={i} h="2.75rem" className="af-skel--side" />
            ))}
          </div>
        </div>
        <div className="af-shell__main">
          <div className="af-shell__inner">
            <div className="af-shell__head">
              <Bloco w="12rem" h="2rem" />
            </div>
            <div className="af-shell__body af-shellskel__body">
              <Corpo variant={variant} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
