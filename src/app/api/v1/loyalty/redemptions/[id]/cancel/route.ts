import { defineRoute, preflight } from '@/server/api/define-route'
import { redemptionSchema } from '@/server/api/schemas/loyalty'
import { idParams } from '@/server/api/wire'
import { cancelRedemption } from '@/server/domain/loyalty/redemptions'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/loyalty/redemptions/{id}/cancel',
  auth: 'customer',
  module: 'loyalty',
  summary: 'Cancela um resgate pendente do cliente: os pontos e o estoque voltam',
  tag: 'Fidelidade',
  params: idParams('o resgate'),
  response: redemptionSchema,
  handler: async ({ ctx, params }) => cancelRedemption(ctx, params.id),
})

export const OPTIONS = preflight
