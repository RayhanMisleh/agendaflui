import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listOrders } from '@/server/domain/store/orders'
import { EmptyIllustration, LinkButton, OrderStatusBadge } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { um } from '@/app/_lib/params'
import { ClientePagina } from '@/ui/shells'
import { modulosDaLoja } from '../../../_lib/modulos'
import { ModuloDesligado } from '../../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../../_lib/loja'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Meus pedidos')
}

/** Meus pedidos: do mais novo ao mais antigo, com a situação em texto e "Carregar mais". */
export default async function PedidosPage({ params, searchParams }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/loja/pedidos`)
  const voltar = { href: `/${slug}/loja`, label: 'Loja' }
  if (!(await modulosDaLoja(visit)).store) {
    return (
      <ClientePagina title="Meus pedidos" back={voltar}>
        <ModuloDesligado slug={slug} what="Loja" />
      </ClientePagina>
    )
  }
  const cursor = um((await searchParams).cursor)
  let pagina
  try {
    pagina = await listOrders(visit.ctx, cursor ? { cursor } : {})
  } catch (err) {
    if (!(err instanceof DomainError) || err.fields?.['cursor'] === undefined) throw err
    pagina = await listOrders(visit.ctx)
  }
  return (
    <ClientePagina
      title="Meus pedidos"
      back={voltar}
      actions={
        <LinkButton href={`/${slug}/loja/enderecos`} variant="secondary" size="sm">
          Endereços
        </LinkButton>
      }
    >
      {pagina.items.length === 0 ? (
        <div className="af-cl-state af-cl-state--inline">
          <span className="af-cl-state__art">
            <EmptyIllustration name="pedidos" size={96} />
          </span>
          <p className="af-cl-state__title">Nenhum pedido ainda</p>
          <p className="af-cl-state__text">Quando você comprar na loja, o pedido aparece aqui.</p>
          <LinkButton href={`/${slug}/loja`} variant="primary" size="lg">
            Ver a loja
          </LinkButton>
        </div>
      ) : (
        <ul className="af-cl-orders">
          {pagina.items.map((o) => (
            <li key={o.id}>
              <Link href={`/${slug}/loja/pedidos/${o.id}`} className="af-cl-order">
                <span className="af-cl-order__main">
                  <span className="af-cl-order__number">Pedido {o.number}</span>
                  <span className="af-cl-order__date">{o.createdLabel}</span>
                </span>
                <span className="af-cl-order__side">
                  <span className="af-cl-order__total">{formatMoney(o.totalCents)}</span>
                  <OrderStatusBadge status={o.status} fulfillmentStatus={o.fulfillmentStatus} deliveryMethod={o.deliveryMethod} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pagina.nextCursor ? (
        <LinkButton href={`/${slug}/loja/pedidos?cursor=${encodeURIComponent(pagina.nextCursor)}`} variant="secondary">
          Carregar mais
        </LinkButton>
      ) : null}
    </ClientePagina>
  )
}
