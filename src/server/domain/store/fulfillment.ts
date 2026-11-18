import type { DeliveryMethod, FulfillmentStatus } from '@/server/db/generated/client'

export type FulfillmentStep = { to: FulfillmentStatus; label: string }

/** Rótulo do botão que leva o pedido a cada etapa, por forma de entrega. */
const FORWARD: Record<DeliveryMethod, Partial<Record<FulfillmentStatus, FulfillmentStep>>> = {
  PICKUP: { PENDING: { to: 'READY_FOR_PICKUP', label: 'Marcar pronto para retirar' }, READY_FOR_PICKUP: { to: 'DELIVERED', label: 'Marcar como entregue' } },
  SHIPPING: { PENDING: { to: 'SHIPPED', label: 'Marcar como enviado' }, SHIPPED: { to: 'DELIVERED', label: 'Marcar como entregue' } },
  NONE: { PENDING: { to: 'DELIVERED', label: 'Marcar como entregue' } },
}

const BACK: Record<DeliveryMethod, Partial<Record<FulfillmentStatus, FulfillmentStatus>>> = {
  PICKUP: { READY_FOR_PICKUP: 'PENDING', DELIVERED: 'READY_FOR_PICKUP' },
  SHIPPING: { SHIPPED: 'PENDING', DELIVERED: 'SHIPPED' },
  NONE: { DELIVERED: 'PENDING' },
}

/**
 * Os passos que a equipe pode dar numa entrega, a partir da etapa atual: o próximo (com o rótulo do botão) e voltar um passo
 * (engano). É o mesmo mapa de transições que `advanceFulfillment` aceita; o domínio confere de novo ao gravar.
 */
export function fulfillmentSteps(method: DeliveryMethod, current: FulfillmentStatus): { next: FulfillmentStep | null; back: FulfillmentStatus | null } {
  return { next: FORWARD[method][current] ?? null, back: BACK[method][current] ?? null }
}
