import { appWebOrigins } from '@/server/api/cors'
import { defineRoute, preflight } from '@/server/api/define-route'
import { idParams, isoInstant } from '@/server/api/wire'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { startCheckout } from '@/server/domain/store/checkout'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/store/orders/{id}/checkout',
  auth: 'customer',
  module: 'store',
  summary:
    'Começa o pagamento de um pedido pelo Mercado Pago (Checkout Pro) e devolve o endereço para onde levar o cliente. A segunda chamada devolve o mesmo endereço. `returnUrl` (opcional) precisa ser um endereço do app web. Pedido que não aguarda mais o pagamento: 409 `invalid_transition`; pagamento fora do ar: 409 `payment_unavailable`',
  tag: 'Loja',
  params: idParams('o pedido'),
  body: z.object({ returnUrl: z.string().max(500).nullable().optional().describe('Para onde o Mercado Pago devolve o cliente depois de pagar. Precisa ser um endereço do app web (no app nativo, envie sem).') }),
  bodyOptional: true,
  response: z.object({
    checkoutUrl: z.string().describe('Endereço do pagamento no Mercado Pago.'),
    expiresAt: isoInstant.describe('Fim do prazo para pagar.'),
    expiresLabel: z.string().describe('O mesmo prazo em texto, no horário da conta.'),
  }),
  limit: LIMITS.order,
  limitBy: 'subject',
  handler: async ({ ctx, params, body }) => startCheckout(ctx, params.id, { returnUrl: body.returnUrl ?? null, webOrigins: appWebOrigins() }),
})

export const OPTIONS = preflight
