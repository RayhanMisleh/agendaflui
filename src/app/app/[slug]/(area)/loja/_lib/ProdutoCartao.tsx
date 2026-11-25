import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import type { PublicProduct } from '@/server/domain/store/products'
import { formatMoney } from '@/ui/format'

/** Um produto da vitrine: imagem quadrada, nome, preço (com o de antes riscado na promoção) e "Esgotado". */
export function ProdutoCartao({ slug, produto }: { slug: string; produto: PublicProduct }) {
  const imagem = produto.images[0]?.url ?? null
  return (
    <li className="af-cl-product">
      <Link href={`/${slug}/loja/produto/${produto.id}`} className="af-cl-product__link">
        <span className="af-cl-product__media" aria-hidden="true">
          {imagem ? (
            // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta
            <img src={imagem} alt="" loading="lazy" />
          ) : (
            <ShoppingBag size={32} />
          )}
          {produto.available ? null : <span className="af-cl-product__soldout">Esgotado</span>}
        </span>
        <span className="af-cl-product__name">{produto.name}</span>
        <span className="af-cl-product__price">
          {produto.promoPriceCents !== null ? <s className="af-cl-product__old">{formatMoney(produto.priceCents)}</s> : null}
          <span>{formatMoney(produto.finalPriceCents)}</span>
          {produto.available ? null : <span className="af-sr"> (esgotado)</span>}
        </span>
      </Link>
    </li>
  )
}
