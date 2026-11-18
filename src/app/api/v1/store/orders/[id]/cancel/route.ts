import { defineRoute, preflight } from '@/server/api/define-route'
import { orderSchema, toWireOrder } from '@/server/api/schemas/store'
import { idParams } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { cancelOrder } from '@/server/domain/store/orders'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/store/orders/{id}/cancel',
  auth: 'customer',
  module: 'store',
  summary: 'Cancela um pedido do cliente que ainda aguarda o pagamento: o estoque reservado volta. Pedido já pago, vencido ou cancelado: 409 `invalid_transition`',
  tag: 'Loja',
  params: idParams('o pedido'),
  body: z.object({ reason: z.string().max(1000).nullable().optional().describe('Motivo (até 300 caracteres).') }),
  bodyOptional: true,
  response: orderSchema,
  handler: async ({ ctx, params, body }) => toWireOrder(await cancelOrder(ctx, params.id, { reason: body.reason ?? null })),
})

export const OPTIONS = preflight
