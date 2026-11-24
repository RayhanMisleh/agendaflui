import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { SubmitButton } from '@/ui/components'
import { ImagemUpload } from '../_lib/ImagemUpload'

const MAXIMO = 6

/**
 * A galeria do produto: cada imagem é uma linha com subir, descer e remover (formulários POST, sem JavaScript) e, abaixo,
 * o envio de uma imagem nova enquanto houver vaga (até 6). A primeira imagem é a da vitrine.
 */
export function ProdutoImagens({ productId, nome, imagens }: { productId: string; nome: string; imagens: { id: string; url: string }[] }) {
  const action = `/painel/loja/produtos/${productId}/imagens`
  const botao = (intent: 'up' | 'down' | 'remove', imageId: string, rotulo: string, icone: React.ReactNode, desativado = false) => (
    <form method="post" action={action} encType="multipart/form-data">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="imageId" value={imageId} />
      <SubmitButton size="sm" variant={intent === 'remove' ? 'ghost' : 'secondary'} icon={icone} disabled={desativado} aria-label={rotulo}>
        {intent === 'remove' ? 'Remover' : ''}
      </SubmitButton>
    </form>
  )
  return (
    <>
      {imagens.length > 0 ? (
        <ul className="af-gallery" aria-label={`Imagens de ${nome}`}>
          {imagens.map((img, i) => (
            <li key={img.id} className="af-gallery__item">
              {/* eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta; sem otimização aqui */}
              <img src={img.url} alt={`${nome}, imagem ${i + 1}`} className="af-gallery__img" />
              <span className="af-gallery__label">{i === 0 ? 'Imagem principal' : `Imagem ${i + 1}`}</span>
              <span className="af-gallery__actions">
                {botao('up', img.id, `Subir a imagem ${i + 1}`, <ArrowUp size={16} />, i === 0)}
                {botao('down', img.id, `Descer a imagem ${i + 1}`, <ArrowDown size={16} />, i === imagens.length - 1)}
                {botao('remove', img.id, `Remover a imagem ${i + 1}`, <Trash2 size={16} />)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="af-section__help">Este produto ainda não tem imagem. Envie a primeira abaixo.</p>
      )}
      {imagens.length < MAXIMO ? (
        <ImagemUpload action={action} rotulo="Nova imagem" src={null} dica={`JPEG, PNG ou WebP, até 8 MB. Faltam ${MAXIMO - imagens.length} para o máximo de ${MAXIMO}.`} />
      ) : (
        <p className="af-section__help">O produto já tem {MAXIMO} imagens. Remova uma para enviar outra.</p>
      )}
    </>
  )
}
