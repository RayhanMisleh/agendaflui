import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { fulfillmentSteps } from '@/server/domain/store/fulfillment'
import { getOrder } from '@/server/domain/store/orders'
import type { OrderAttention, OrderView } from '@/server/domain/store/orders'
import { listOrderPayments } from '@/server/domain/store/payments'
import type { OrderPaymentView } from '@/server/domain/store/payments'
import { canSimulatePayment } from '@/server/domain/store/simulate'
import { ATTENTION_LABELS, Card, LinkButton, OrderStatusBadge } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { PainelFrame } from '../../../PainelFrame'
import { requirePainelModule } from '../../../_lib/modulo'
import { PedidoAcoes } from '../PedidoAcoes'

export const metadata: Metadata = { title: 'Pedido | AgendaFlui' }

/** O que houve e o que fazer, para cada pedido que pede atenção. */
const ATENCAO: Record<OrderAttention, string> = {
  amount_mismatch:
    'O Mercado Pago aprovou um pagamento com valor ou moeda diferentes do pedido, por isso o pedido não foi marcado como pago. Confira o valor pago abaixo. Se o pagamento estiver certo, combine com o cliente; senão, estorne no painel do Mercado Pago.',
  stock_shortfall:
    'O cliente pagou depois do prazo e já não havia estoque de todos os itens. Fale com o cliente para combinar a entrega, ou cancele o pedido e estorne o pagamento no painel do Mercado Pago.',
  payment_reversed:
    'O pagamento foi devolvido ou contestado depois de a entrega começar, então os itens não voltaram ao estoque. Confira com o cliente o que ele recebeu e recupere o que for devido.',
}

const SITUACAO_DO_PAGAMENTO: Record<OrderPaymentView['status'], string> = {
  PENDING: 'Pendente',
  IN_PROCESS: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
  CANCELED: 'Cancelado',
  REFUNDED: 'Devolvido',
  CHARGED_BACK: 'Contestado',
}

const SIMULAR = { aviso: 'Ambiente de teste', texto: 'Este botão não existe em produção: ele faz de conta que o Mercado Pago aprovou o pagamento.', label: 'Simular pagamento aprovado' }

const CANCELAR_PAGO =
  'O estorno do pagamento é feito no painel do Mercado Pago. Cancelar aqui devolve os itens ao estoque se ainda não saíram.'
const CANCELAR_ABERTO = 'O pedido ainda não foi pago. Cancelar devolve os itens ao estoque e o cliente não consegue mais pagar por ele.'

function entregaEmTexto(o: OrderView): string {
  if (o.deliveryMethod === 'PICKUP') return 'Retirada no local'
  if (o.deliveryMethod === 'SHIPPING') return o.shipping ? `Entrega por ${o.shipping.serviceName}, prazo de ${o.shipping.days} ${o.shipping.days === 1 ? 'dia' : 'dias'}` : 'Entrega'
  return 'Sem entrega'
}

export default async function PedidoPage({ params }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('manage_store')
  await requirePainelModule(ctx, 'store')
  const { id } = await params
  let pedido: OrderView
  let pagamentos: OrderPaymentView[]
  try {
    pedido = await getOrder(ctx, id)
    pagamentos = await listOrderPayments(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const numero = `#${pedido.number}`
  const paga = pedido.status === 'PAID'
  const passos = paga ? fulfillmentSteps(pedido.deliveryMethod, pedido.fulfillmentStatus) : { next: null, back: null }
  const simular = pedido.status === 'AWAITING_PAYMENT' && canSimulatePayment()
  const proximo = passos.next ? { to: passos.next.to, label: passos.next.label, askTracking: passos.next.to === 'SHIPPED' } : null
  const voltar = passos.back ? { to: passos.back, label: 'Voltar um passo' } : null
  const temAcoes = proximo !== null || voltar !== null || pedido.canCancel || simular
  const linhaDoTempo: string[] = [`Pedido criado em ${pedido.createdLabel}`]
  if (pedido.paidLabel) linhaDoTempo.push(`Pago em ${pedido.paidLabel}`)
  if (pedido.status === 'AWAITING_PAYMENT') linhaDoTempo.push(`Aguardando pagamento até ${pedido.expiresLabel}`)
  if (pedido.status === 'EXPIRED') linhaDoTempo.push(`Venceu sem pagamento em ${pedido.expiresLabel}`)
  if (pedido.fulfillmentStatus === 'DELIVERED' && paga) linhaDoTempo.push('Entregue')
  if (pedido.status === 'CANCELED') linhaDoTempo.push(`Cancelado${pedido.canceledLabel ? ` em ${pedido.canceledLabel}` : ''}${pedido.cancelReason ? `: ${pedido.cancelReason}` : ''}`)

  return (
    <PainelFrame
      ctx={ctx}
      title={`Pedido ${numero}`}
      actions={
        <LinkButton href="/loja" variant="ghost">
          Voltar para a loja
        </LinkButton>
      }
    >
      <div className="af-profile af-profile--narrow">
        <Card as="section" aria-labelledby="pedido-resumo" className="af-profile">
          <h2 id="pedido-resumo" className="af-section__title">
            Situação
          </h2>
          <p>
            <OrderStatusBadge status={pedido.status} fulfillmentStatus={pedido.fulfillmentStatus} deliveryMethod={pedido.deliveryMethod} attention={pedido.attention} />
          </p>
          {pedido.attention ? (
            <p role="note" className="af-ordernote">
              <strong>{ATTENTION_LABELS[pedido.attention]}.</strong> {ATENCAO[pedido.attention]}
            </p>
          ) : null}
          {temAcoes ? (
            <PedidoAcoes id={pedido.id} numero={numero} next={proximo} back={voltar} canCancel={pedido.canCancel} cancelHelp={paga ? CANCELAR_PAGO : CANCELAR_ABERTO} simulate={simular ? SIMULAR : null} />
          ) : null}
        </Card>

        <Card as="section" aria-labelledby="pedido-itens" className="af-profile">
          <h2 id="pedido-itens" className="af-section__title">
            Itens
          </h2>
          <table className="af-ordertable">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="af-col--end">
                  Preço da compra
                </th>
                <th scope="col" className="af-col--end">
                  Qtd.
                </th>
                <th scope="col" className="af-col--end">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {pedido.items.map((i) => (
                <tr key={`${i.kind}-${i.id}`}>
                  <td>{i.name}</td>
                  <td className="af-col--end af-tabular">{formatMoney(i.unitPriceCents)}</td>
                  <td className="af-col--end af-tabular">{i.quantity}</td>
                  <td className="af-col--end af-tabular">{formatMoney(i.totalCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Itens
                </th>
                <td className="af-col--end af-tabular">{formatMoney(pedido.itemsCents)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Frete
                </th>
                <td className="af-col--end af-tabular">{formatMoney(pedido.shippingCents)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Total do pedido
                </th>
                <td className="af-col--end af-tabular">{formatMoney(pedido.totalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <Card as="section" aria-labelledby="pedido-cliente" className="af-profile">
          <h2 id="pedido-cliente" className="af-section__title">
            Cliente e entrega
          </h2>
          <dl className="af-orderinfo">
            <div>
              <dt>Cliente</dt>
              <dd>
                <Link href={`/clientes/${pedido.customer.id}`}>{pedido.customer.name}</Link>
              </dd>
            </div>
            <div>
              <dt>Entrega</dt>
              <dd>{entregaEmTexto(pedido)}</dd>
            </div>
            {pedido.deliveryMethod === 'PICKUP' && pedido.pickupInstructions ? (
              <div>
                <dt>Instruções de retirada</dt>
                <dd>{pedido.pickupInstructions}</dd>
              </div>
            ) : null}
            {pedido.address ? (
              <div>
                <dt>Endereço de entrega</dt>
                <dd>
                  {pedido.address.recipientName}
                  <br />
                  {pedido.address.street}, {pedido.address.number}
                  {pedido.address.complement ? `, ${pedido.address.complement}` : ''}
                  <br />
                  {pedido.address.district}, {pedido.address.city} - {pedido.address.state}
                  <br />
                  CEP {pedido.address.postalCode}
                </dd>
              </div>
            ) : null}
            {pedido.shipping?.trackingCode ? (
              <div>
                <dt>Código de rastreio</dt>
                <dd>{pedido.shipping.trackingCode}</dd>
              </div>
            ) : null}
            {pedido.customerNote ? (
              <div>
                <dt>Observação do cliente</dt>
                <dd>{pedido.customerNote}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card as="section" aria-labelledby="pedido-pagamentos" className="af-profile">
          <h2 id="pedido-pagamentos" className="af-section__title">
            Pagamentos
          </h2>
          {pagamentos.length === 0 ? (
            <p className="af-section__help">Nenhum pagamento do Mercado Pago chegou para este pedido.</p>
          ) : (
            <table className="af-ordertable">
              <thead>
                <tr>
                  <th scope="col">Situação</th>
                  <th scope="col" className="af-col--end">
                    Valor
                  </th>
                  <th scope="col">Identificador no Mercado Pago</th>
                  <th scope="col">Atualizado em</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((p) => (
                  <tr key={p.providerPaymentId}>
                    <td>{SITUACAO_DO_PAGAMENTO[p.status]}</td>
                    <td className="af-col--end af-tabular">{formatMoney(p.amountCents)}</td>
                    <td className="af-tabular">{p.providerPaymentId}</td>
                    <td>{p.updatedLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card as="section" aria-labelledby="pedido-tempo" className="af-profile">
          <h2 id="pedido-tempo" className="af-section__title">
            Linha do tempo
          </h2>
          <ul className="af-timeline">
            {linhaDoTempo.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Card>
      </div>
    </PainelFrame>
  )
}
