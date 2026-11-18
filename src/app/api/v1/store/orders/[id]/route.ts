import { defineRoute, preflight } from '@/server/api/define-route'
import { orderSchema, toWireOrder } from '@/server/api/schemas/store'
import { idParams } from '@/server/api/wire'
import { getOrder } from '@/server/domain/store/orders'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/store/orders/{id}',
  auth: 'customer',
  module: 'store',
  summary: 'Um pedido do cliente. Pedido de outra pessoa ou de outra conta: 404',
  tag: 'Loja',
  params: idParams('o pedido'),
  response: orderSchema,
  handler: async ({ ctx, params }) => toWireOrder(await getOrder(ctx, params.id)),
})

export const OPTIONS = preflight
