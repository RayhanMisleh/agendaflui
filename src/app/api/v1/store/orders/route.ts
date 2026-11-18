import { defineRoute, preflight } from '@/server/api/define-route'
import { orderSchema, toWireOrder } from '@/server/api/schemas/store'
import { pageCursor, pageLimit } from '@/server/api/wire'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { DomainError, z } from '@/server/domain/errors'
import { createOrder, listOrders } from '@/server/domain/store/orders'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/store/orders',
  auth: 'customer',
  module: 'store',
  summary: 'Pedidos do cliente, do mais novo ao mais antigo, com paginação por cursor',
  tag: 'Loja',
  query: z.object({
    status: z.enum(['AWAITING_PAYMENT', 'PAID', 'CANCELED', 'EXPIRED']).optional().describe('Só os pedidos nesta situação.'),
    cursor: pageCursor.optional(),
    limit: pageLimit(100, 30),
  }),
  response: z.object({ items: z.array(orderSchema), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, query }) => {
    const r = await listOrders(ctx, { limit: query.limit, ...(query.status === undefined ? {} : { status: query.status }), ...(query.cursor === undefined ? {} : { cursor: query.cursor }) })
    return { items: r.items.map(toWireOrder), nextCursor: r.nextCursor }
  },
})

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/store/orders',
  auth: 'customer',
  module: 'store',
  status: 201,
  alternateStatuses: [200],
  summary:
    'Faz o pedido do cliente e reserva o estoque. O servidor refaz os preços no banco e o frete vem do `quoteToken`: `priceCents`, `totalCents` e `shippingCents` no corpo são recusados (422). O cabeçalho Idempotency-Key é obrigatório (422 sem ele): repetir o mesmo pedido com a mesma chave em até 24 h devolve o mesmo pedido (200), e uma nova cotação entre as tentativas é outro pedido (409 `idempotency_key_reused`). Cada cliente pode ter até 3 pedidos aguardando pagamento (409 `too_many_open_orders`)',
  tag: 'Loja',
  body: z.object({
    lines: z.array(z.strictObject({ productId: z.string().max(64), quantity: z.number() })).max(100).describe('Os produtos do pedido: só o id e a quantidade.'),
    delivery: z.discriminatedUnion('method', [
      z.strictObject({ method: z.literal('PICKUP') }).describe('Retirada no local.'),
      z
        .strictObject({ method: z.literal('SHIPPING'), addressId: z.string().max(64), quoteToken: z.string().max(2000).describe('O `quoteToken` da opção escolhida em `/v1/store/shipping-quotes`, para este mesmo carrinho e endereço.') })
        .describe('Entrega no endereço, pelo serviço da cotação.'),
    ]),
    note: z.string().max(1000).nullable().optional().describe('Observação do cliente (até 300 caracteres).'),
  }),
  response: orderSchema,
  limit: LIMITS.order,
  limitBy: 'subject',
  idempotent: 'required',
  handler: async ({ ctx, body, request, setStatus }) => {
    const key = request.headers.get('idempotency-key')
    // Sem a chave, um toque duplo faria dois pedidos e reservaria o estoque duas vezes: o app manda uma chave nova por pedido.
    if (key === null || key.trim() === '') {
      const message = 'Envie o cabeçalho Idempotency-Key, com uma chave diferente para cada pedido.'
      throw new DomainError('validation', message, { fields: { 'Idempotency-Key': message } })
    }
    const { order, replayed } = await createOrder(ctx, { lines: body.lines, delivery: body.delivery, note: body.note ?? null, idempotencyKey: key })
    if (replayed) setStatus(200)
    return toWireOrder(order)
  },
})

export const OPTIONS = preflight
