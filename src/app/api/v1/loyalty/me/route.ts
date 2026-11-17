import { defineRoute, preflight } from '@/server/api/define-route'
import { loyaltyMeSchema } from '@/server/api/schemas/loyalty'
import { getCustomerLoyalty } from '@/server/domain/loyalty/ledger'
import { getLoyaltyTerms } from '@/server/domain/loyalty/settings'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/loyalty/me',
  auth: 'customer',
  module: 'loyalty',
  summary: 'Saldo de pontos do cliente, se é sócio do clube e os termos da conta para os rótulos',
  tag: 'Fidelidade',
  response: loyaltyMeSchema,
  handler: async ({ ctx }) => {
    if (ctx.actor.kind !== 'customer') throw new Error('Rota de cliente sem cliente no contexto.')
    const loyalty = await getCustomerLoyalty(ctx, ctx.actor.customerId)
    return { ...loyalty, terms: await getLoyaltyTerms(ctx) }
  },
})

export const OPTIONS = preflight
