import { defineRoute, preflight } from '@/server/api/define-route'
import { shippingQuoteSchema } from '@/server/api/schemas/store'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { quoteShipping } from '@/server/domain/store/shipping'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/store/shipping-quotes',
  auth: 'customer',
  module: 'store',
  summary:
    'Cota o frete de um carrinho para um endereço do cliente. Cada opção traz um `quoteToken` assinado (válido por 30 minutos) que o pedido confere: o app nunca manda o preço do frete. Entrega indisponível não é erro: volta `shippingError` e a retirada, se ligada, segue disponível',
  tag: 'Loja',
  body: z.object({
    addressId: z.string().max(64).describe('Id de um endereço do próprio cliente.'),
    lines: z
      .array(z.strictObject({ productId: z.string().max(64), quantity: z.number() }))
      .max(100)
      .describe('Os itens do carrinho: só o id do produto e a quantidade. O preço vem do servidor.'),
  }),
  response: shippingQuoteSchema,
  limit: LIMITS.shippingQuote,
  limitBy: 'subject',
  handler: async ({ ctx, body }) => quoteShipping(ctx, body),
})

export const OPTIONS = preflight
