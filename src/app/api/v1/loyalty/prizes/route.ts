import { defineRoute, preflight } from '@/server/api/define-route'
import { prizeSchema } from '@/server/api/schemas/loyalty'
import { z } from '@/server/domain/errors'
import { listPrizes } from '@/server/domain/loyalty/prizes'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/loyalty/prizes',
  auth: 'key_or_customer',
  module: 'loyalty',
  summary: 'Prêmios ativos com estoque, na ordem da vitrine. O estoque não é exposto: só `available`',
  tag: 'Fidelidade',
  response: z.object({ items: z.array(prizeSchema) }),
  handler: async ({ ctx }) => ({
    items: (await listPrizes(ctx)).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      costPoints: p.costPoints,
      imageUrl: p.imageUrl,
      available: p.stock === null || p.stock > 0,
    })),
  }),
})

export const OPTIONS = preflight
