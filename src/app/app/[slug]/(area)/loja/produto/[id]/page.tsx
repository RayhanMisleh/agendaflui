import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getPublicProduct } from '@/server/domain/store/products'
import { formatMoney } from '@/ui/format'
import { ClientePagina } from '@/ui/shells'
import { modulosDaLoja } from '../../../../_lib/modulos'
import { ModuloDesligado } from '../../../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../../../_lib/loja'
import { BotaoDoCarrinho } from '../../_lib/BotaoDoCarrinho'
import { Galeria } from '../../_lib/Galeria'
import { PorNoCarrinho } from '../../_lib/PorNoCarrinho'
import { readCart, totalDeUnidades } from '../../_lib/carrinho'

type Props = { params: Promise<{ slug: string; id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Loja')
}

/** Um produto: fotos, descrição, preço, quantidade e "Pôr no carrinho". Produto que não é desta loja ou saiu do ar: não encontrado. */
export default async function ProdutoPage({ params }: Props) {
  const { slug, id } = await params
  const visit = await requireCustomer(slug, `/${slug}/loja/produto/${id}`)
  if (!(await modulosDaLoja(visit)).store) {
    return (
      <ClientePagina title="Loja">
        <ModuloDesligado slug={slug} what="Loja" />
      </ClientePagina>
    )
  }
  let produto
  try {
    produto = await getPublicProduct(visit.ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const unidades = totalDeUnidades(await readCart())
  return (
    <ClientePagina title={produto.name} back={{ href: `/${slug}/loja`, label: 'Loja' }} actions={<BotaoDoCarrinho slug={slug} unidades={unidades} />}>
      <div className="af-cl-pdp">
        <Galeria imagens={produto.images} nome={produto.name} />
        <div className="af-cl-pdp__info">
          <p className="af-cl-pdp__price">
            {produto.promoPriceCents !== null ? <s className="af-cl-product__old">{formatMoney(produto.priceCents)}</s> : null}
            <span>{formatMoney(produto.finalPriceCents)}</span>
          </p>
          {produto.description ? <p className="af-cl-pdp__desc">{produto.description}</p> : null}
          <PorNoCarrinho slug={slug} productId={produto.id} max={produto.maxQuantity} />
        </div>
      </div>
    </ClientePagina>
  )
}
