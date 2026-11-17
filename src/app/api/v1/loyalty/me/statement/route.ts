import { defineRoute, preflight } from '@/server/api/define-route'
import { loyaltyEntrySchema } from '@/server/api/schemas/loyalty'
import { pageCursor, pageLimit } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { listLoyaltyEntries } from '@/server/domain/loyalty/ledger'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/loyalty/me/statement',
  auth: 'customer',
  module: 'loyalty',
  summary: 'Extrato de pontos do cliente, do mais recente ao mais antigo, com paginação por cursor',
  tag: 'Fidelidade',
  query: z.object({ cursor: pageCursor.optional(), limit: pageLimit(100, 30) }),
  response: z.object({ items: z.array(loyaltyEntrySchema), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, query }) => {
    if (ctx.actor.kind !== 'customer') throw new Error('Rota de cliente sem cliente no contexto.')
    return listLoyaltyEntries(ctx, ctx.actor.customerId, { limit: query.limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) })
  },
})

export const OPTIONS = preflight
