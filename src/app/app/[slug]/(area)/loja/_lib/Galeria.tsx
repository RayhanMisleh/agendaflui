'use client'
import { useRef, useState } from 'react'
import { ShoppingBag } from 'lucide-react'

/** Imagens do produto em rolagem com encaixe e o indicador de qual está à vista. Sem imagem, um desenho no lugar. */
export function Galeria({ imagens, nome }: { imagens: { url: string }[]; nome: string }) {
  const faixa = useRef<HTMLDivElement>(null)
  const [atual, setAtual] = useState(0)
  if (imagens.length === 0) {
    return (
      <div className="af-cl-gallery af-cl-gallery--empty" aria-hidden="true">
        <ShoppingBag size={48} />
      </div>
    )
  }
  return (
    <div className="af-cl-gallery">
      <div
        ref={faixa}
        className="af-cl-gallery__strip"
        tabIndex={0}
        role="group"
        aria-label={`Fotos de ${nome}`}
        onScroll={(e) => {
          const el = e.currentTarget
          setAtual(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
        }}
      >
        {imagens.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta
          <img key={img.url} src={img.url} alt={i === 0 ? nome : `${nome}, foto ${i + 1}`} className="af-cl-gallery__img" />
        ))}
      </div>
      {imagens.length > 1 ? (
        <>
          <p className="af-sr" aria-live="polite">
            Foto {Math.min(atual + 1, imagens.length)} de {imagens.length}
          </p>
          <div className="af-cl-gallery__dots" aria-hidden="true">
            {imagens.map((img, i) => (
              <span key={img.url} className={i === atual ? 'is-on' : undefined} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
