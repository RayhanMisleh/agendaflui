import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { refreshMyOrderPayment } from '@/server/domain/store/checkout'
import { getOrder, type OrderView } from '@/server/domain/store/orders'
import { OrderStatusBadge } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { ClienteFrame, modulosDaLoja } from '../../../_lib/ClienteFrame'
import { ModuloDesligado } from '../../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../../_lib/loja'
import { AcoesDoPedido } from './AcoesDoPedido'

type Props = { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Pedido')
}

/** Sinais com que o Mercado Pago (ou a ação de pagar) devolve a pessoa para cá. */
const VOLTA_DO_PAGAMENTO = ['status', 'collection_status', 'payment_id', 'pagamento']

function Situacao({ order }: { order: OrderView }) {
  if (order.status === 'PAID') return <p className="af-cl-notice af-cl-notice--ok">Pagamento confirmado.</p>
  if (order.status === 'AWAITING_PAYMENT') return <p className="af-cl-notice">Aguardando o pagamento até {order.expiresLabel}.</p>
  if (order.status === 'EXPIRED') return <p className="af-cl-notice">O prazo para pagar venceu e o pedido foi encerrado.</p>
  return <p className="af-cl-notice">Pedido cancelado{order.cancelReason ? `: ${order.cancelReason}` : '.'}</p>
}

/** Um pedido: situação em texto, itens, entrega, totais e as ações possíveis. A volta do Mercado Pago confere o pagamento. */
export default async function PedidoPage({ params, searchParams }: Props) {
  const { slug, id } = await params
  const visit = await requireCustomer(slug, `/${slug}/loja/pedidos/${id}`)
  const voltar = { href: `/${slug}/loja/pedidos`, label: 'Meus pedidos' }
  if (!(await modulosDaLoja(visit)).store) {
    return (
      <ClienteFrame visit={visit} title="Pedido" back={voltar}>
        <ModuloDesligado slug={slug} what="Loja" />
      </ClienteFrame>
    )
  }
  const q = await searchParams
  const veioDoPagamento = VOLTA_DO_PAGAMENTO.some((k) => q[k] !== undefined)
  let pedido: OrderView
  try {
    pedido = veioDoPagamento ? await refreshMyOrderPayment(visit.ctx, id) : await getOrder(visit.ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const semPagamento = q['pagamento'] === 'indisponivel' && pedido.status === 'AWAITING_PAYMENT'
  return (
    <ClienteFrame visit={visit} title={`Pedido ${pedido.number}`} back={voltar}>
      <div className="af-cl-order-page">
        <div className="af-cl-order-page__status">
          <OrderStatusBadge status={pedido.status} fulfillmentStatus={pedido.fulfillmentStatus} deliveryMethod={pedido.deliveryMethod} />
          <span className="af-cl-muted">Feito em {pedido.createdLabel}</span>
        </div>
        <Situacao order={pedido} />
        {semPagamento ? (
          <p role="alert" className="af-cl-notice">
            A loja ainda não recebe pagamento por aqui. Fale com a loja.
          </p>
        ) : null}

        <section aria-labelledby="itens-titulo">
          <h2 id="itens-titulo" className="af-cl-section">
            Itens
          </h2>
          <ul className="af-cl-bill">
            {pedido.items.map((i) => (
              <li key={`${i.id}-${i.name}`} className="af-cl-bill__row">
                <span>
                  {i.quantity} × {i.name}
                </span>
                <span>{formatMoney(i.totalCents)}</span>
              </li>
            ))}
            {pedido.shipping ? (
              <li className="af-cl-bill__row">
                <span>Frete ({pedido.shipping.serviceName})</span>
                <span>{formatMoney(pedido.shippingCents)}</span>
              </li>
            ) : null}
            <li className="af-cl-bill__row af-cl-bill__row--total">
              <strong>Total</strong>
              <strong>{formatMoney(pedido.totalCents)}</strong>
            </li>
          </ul>
        </section>

        <section aria-labelledby="entrega-titulo">
          <h2 id="entrega-titulo" className="af-cl-section">
            {pedido.deliveryMethod === 'PICKUP' ? 'Retirada na loja' : 'Entrega'}
          </h2>
          {pedido.deliveryMethod === 'PICKUP' ? (
            <p className="af-cl-pre">{pedido.pickupInstructions ?? 'Retire na loja com o número do pedido.'}</p>
          ) : pedido.address ? (
            <>
              <p className="af-cl-pre">
                {pedido.address.recipientName}
                {'\n'}
                {pedido.address.street}, {pedido.address.number}
                {pedido.address.complement ? ` · ${pedido.address.complement}` : ''}
                {'\n'}
                {pedido.address.district} · {pedido.address.city} - {pedido.address.state}
                {'\n'}CEP {pedido.address.postalCode}
              </p>
              {pedido.shipping ? (
                <p className="af-cl-muted">
                  {pedido.shipping.serviceName}, até {pedido.shipping.days} {pedido.shipping.days === 1 ? 'dia útil' : 'dias úteis'}.
                  {pedido.shipping.trackingCode ? ` Rastreio: ${pedido.shipping.trackingCode}.` : ''}
                </p>
              ) : null}
            </>
          ) : null}
          {pedido.customerNote ? <p className="af-cl-muted">Seu recado: {pedido.customerNote}</p> : null}
        </section>

        <AcoesDoPedido slug={slug} id={pedido.id} canPay={pedido.canPay} canCancel={pedido.canCancel} />
      </div>
    </ClienteFrame>
  )
}
