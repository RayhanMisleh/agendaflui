import { StatusBadge } from './StatusBadge'
import type { BadgeTone } from './StatusBadge'
import { cx } from './cx'

export type OrderStatusKey = 'AWAITING_PAYMENT' | 'PAID' | 'CANCELED' | 'EXPIRED'
export type FulfillmentKey = 'PENDING' | 'READY_FOR_PICKUP' | 'SHIPPED' | 'DELIVERED'
export type DeliveryMethodKey = 'PICKUP' | 'SHIPPING' | 'NONE'
export type OrderAttentionKey = 'amount_mismatch' | 'stock_shortfall' | 'payment_reversed'

/** O que a equipe precisa ver quando um pedido pede atenção. Sempre texto, nunca só cor. */
export const ATTENTION_LABELS: Record<OrderAttentionKey, string> = {
  amount_mismatch: 'Valor divergente',
  stock_shortfall: 'Pago sem estoque',
  payment_reversed: 'Pagamento devolvido',
}

/** A situação do pedido em uma frase curta: pagamento primeiro e, com o pedido pago, a etapa da entrega. */
export function orderStatusText(status: OrderStatusKey, fulfillmentStatus: FulfillmentKey, deliveryMethod: DeliveryMethodKey): string {
  if (status === 'AWAITING_PAYMENT') return 'Aguardando pagamento'
  if (status === 'CANCELED') return 'Cancelado'
  if (status === 'EXPIRED') return 'Venceu sem pagamento'
  if (fulfillmentStatus === 'DELIVERED') return 'Entregue'
  if (fulfillmentStatus === 'SHIPPED') return 'Enviado'
  if (fulfillmentStatus === 'READY_FOR_PICKUP') return 'Pronto para retirar'
  return deliveryMethod === 'SHIPPING' ? 'Pago, a enviar' : deliveryMethod === 'PICKUP' ? 'Pago, a separar' : 'Pago, a entregar'
}

/** A cor do selo de uma situação (o texto sempre vai junto). */
export function orderStatusTone(status: OrderStatusKey, fulfillmentStatus: FulfillmentKey): BadgeTone {
  if (status === 'AWAITING_PAYMENT') return 'pending'
  if (status === 'CANCELED' || status === 'EXPIRED') return 'canceled'
  return fulfillmentStatus === 'DELIVERED' ? 'done' : 'confirmed'
}

/** Selo da situação de um pedido e, quando houver, o selo de atenção ao lado. */
export function OrderStatusBadge({
  status,
  fulfillmentStatus,
  deliveryMethod,
  attention = null,
  className,
}: {
  status: OrderStatusKey
  fulfillmentStatus: FulfillmentKey
  deliveryMethod: DeliveryMethodKey
  attention?: OrderAttentionKey | null
  className?: string
}) {
  return (
    <span className={cx('af-orderbadges', className)}>
      <StatusBadge tone={orderStatusTone(status, fulfillmentStatus)}>{orderStatusText(status, fulfillmentStatus, deliveryMethod)}</StatusBadge>
      {attention === null ? null : <StatusBadge tone="no-show">{ATTENTION_LABELS[attention]}</StatusBadge>}
    </span>
  )
}
