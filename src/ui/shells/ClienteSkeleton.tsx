import type { CSSProperties } from 'react'

export type ClienteSkeletonVariant = 'inicio' | 'lista' | 'detalhe' | 'fluxo' | 'grade'

function Bloco({ w, h, className }: { w?: string; h?: string; className?: string }) {
  const style = { '--w': w, '--h': h } as CSSProperties
  return <span aria-hidden="true" className={`af-skel${className ? ` ${className}` : ''}`} style={style} />
}

function Corpo({ variant }: { variant: ClienteSkeletonVariant }) {
  switch (variant) {
    case 'inicio':
      return (
        <>
          <Bloco w="9rem" h="1.75rem" />
          <Bloco h="11rem" className="af-skel--block" />
          <Bloco w="60%" h="1.25rem" />
          <Bloco h="4rem" className="af-skel--card" />
          <Bloco h="7rem" className="af-skel--card" />
        </>
      )
    case 'lista':
      return (
        <div className="af-cl-skel__list">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="af-cl-skel__row">
              <Bloco w="2.5rem" h="2.5rem" className="af-skel--round" />
              <div className="af-cl-skel__grow">
                <Bloco w="55%" />
                <Bloco w="35%" />
              </div>
            </div>
          ))}
        </div>
      )
    case 'detalhe':
      return (
        <>
          <Bloco h="9rem" className="af-skel--card" />
          <Bloco w="70%" h="1.25rem" />
          <Bloco h="0.875rem" />
          <Bloco w="85%" h="0.875rem" />
          <Bloco h="3.25rem" className="af-skel--card" />
        </>
      )
    case 'fluxo':
      return (
        <>
          <Bloco h="0.5rem" />
          <Bloco w="75%" h="2rem" />
          <div className="af-cl-skel__choices">
            {Array.from({ length: 4 }, (_, i) => (
              <Bloco key={i} h="5rem" className="af-skel--card" />
            ))}
          </div>
        </>
      )
    case 'grade':
      return (
        <div className="af-cl-skel__grid">
          {Array.from({ length: 6 }, (_, i) => (
            <Bloco key={i} h="11rem" className="af-skel--card" />
          ))}
        </div>
      )
  }
}

/**
 * Esqueleto do MIOLO de uma tela da área do cliente: só o cabeçalho e o conteúdo, com blocos que pulsam. A moldura (barra do
 * topo e navegação) é do layout e fica de pé enquanto isto aparece: nada aqui desenha menu. Cada `loading.tsx` escolhe a
 * forma da sua tela. Sem `PageTransition`: o esqueleto não anima, a página real é que entra.
 */
export function ClienteSkeleton({ variant }: { variant: ClienteSkeletonVariant }) {
  return (
    <div role="status" className="af-cl-inner af-cl-skel__body">
      <span className="af-sr">Carregando…</span>
      <Bloco w="12rem" h="2rem" />
      <Corpo variant={variant} />
    </div>
  )
}
