import { ImageOff } from 'lucide-react'
import { cx } from './cx'

/**
 * Miniatura de lista (banner, prêmio, produto): caixa de proporção fixa. Sem imagem mostra só um ícone na caixa; o texto
 * "Sem imagem" fica para o leitor de tela e nunca vaza para fora dela.
 */
export function Thumb({ src, className }: { src: string | null | undefined; className?: string }) {
  return (
    <span className={cx('af-thumb', className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta; sem otimização aqui
        <img src={src} alt="" className="af-thumb__img" loading="lazy" decoding="async" />
      ) : (
        <>
          <ImageOff size={20} aria-hidden="true" />
          <span className="af-sr">Sem imagem</span>
        </>
      )}
    </span>
  )
}
