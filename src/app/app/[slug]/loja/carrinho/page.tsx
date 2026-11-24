import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCustomer } from '@/server/auth/guards'
import { EmptyIllustration, LinkButton } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { ClienteFrame, modulosDaLoja } from '../../_lib/ClienteFrame'
import { ModuloDesligado } from '../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../_lib/loja'
import { readCart } from '../_lib/carrinho'
import { resumirCarrinho } from '../_lib/resumo'
import { LinhaDoCarrinho } from './LinhaDoCarrinho'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Carrinho')
}

/** O carrinho: linhas com quantidade e "Tirar", avisos de estoque, subtotal e "Continuar" para a finalização. */
export default async function CarrinhoPage({ params }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/loja/carrinho`)
  const voltar = { href: `/${slug}/loja`, label: 'Loja' }
  if (!(await modulosDaLoja(visit)).store) {
    return (
      <ClienteFrame visit={visit} title="Carrinho" back={voltar}>
        <ModuloDesligado slug={slug} what="Loja" />
      </ClienteFrame>
    )
  }
  const resumo = await resumirCarrinho(visit.ctx, await readCart())
  return (
    <ClienteFrame visit={visit} title="Carrinho" back={voltar}>
      {resumo.itens.length === 0 ? (
        <div className="af-cl-state af-cl-state--inline">
          <span className="af-cl-state__art">
            <EmptyIllustration name="carrinho" size={96} />
          </span>
          <p className="af-cl-state__title">Seu carrinho está vazio</p>
          <p className="af-cl-state__text">Escolha um produto na loja para começar.</p>
          <LinkButton href={`/${slug}/loja`} variant="primary" size="lg">
            Ver a loja
          </LinkButton>
          <Link href={`/${slug}/loja/pedidos`} className="af-cl-link">
            Meus pedidos
          </Link>
        </div>
      ) : (
        <>
          <ul className="af-cl-lines">
            {resumo.itens.map((item) => (
              <LinhaDoCarrinho key={item.productId} slug={slug} item={item} />
            ))}
          </ul>
          <section className="af-cl-summary" aria-label="Resumo">
            <p className="af-cl-summary__row">
              <span>Subtotal</span>
              <strong>{formatMoney(resumo.subtotalCents)}</strong>
            </p>
            <p className="af-cl-muted">O frete, se houver entrega, aparece no próximo passo.</p>
            {resumo.podeContinuar ? (
              <LinkButton href={`/${slug}/loja/finalizar`} variant="primary" size="lg">
                Continuar
              </LinkButton>
            ) : (
              <p role="alert" className="af-cl-notice">
                Resolva os avisos acima para continuar.
              </p>
            )}
            <div className="af-cl-summary__links">
              <Link href={`/${slug}/loja`} className="af-cl-link">
                Continuar comprando
              </Link>
              <Link href={`/${slug}/loja/pedidos`} className="af-cl-link">
                Meus pedidos
              </Link>
            </div>
          </section>
        </>
      )}
    </ClienteFrame>
  )
}
