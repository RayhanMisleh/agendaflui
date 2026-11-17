import { defineRoute, preflight } from '@/server/api/define-route'
import { redemptionSchema } from '@/server/api/schemas/loyalty'
import { pageCursor, pageLimit } from '@/server/api/wire'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { listRedemptions, redeemPrize } from '@/server/domain/loyalty/redemptions'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/loyalty/redemptions',
  auth: 'customer',
  module: 'loyalty',
  summary: 'Resgates do cliente, do mais recente ao mais antigo, com paginação por cursor',
  tag: 'Fidelidade',
  query: z.object({ cursor: pageCursor.optional(), limit: pageLimit(100, 30) }),
  response: z.object({ items: z.array(redemptionSchema), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, query }) =>
    listRedemptions(ctx, { limit: query.limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) }),
})

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/loyalty/redemptions',
  auth: 'customer',
  module: 'loyalty',
  status: 201,
  alternateStatuses: [200],
  summary:
    'Resgata um prêmio com os pontos do cliente (nasce pendente, para entrega no estabelecimento). Com o cabeçalho Idempotency-Key, repetir o mesmo pedido em até 24 h devolve o mesmo resgate (200)',
  tag: 'Fidelidade',
  body: z.object({ prizeId: z.string().max(64) }),
  response: z.object({ redemption: redemptionSchema, balance: z.number().describe('Saldo de pontos depois do resgate.') }),
  limit: LIMITS.redeem,
  limitBy: 'subject',
  idempotent: true,
  handler: async ({ ctx, body, request, setStatus }) => {
    const key = request.headers.get('idempotency-key')
    const { redemption, balance, replayed } = await redeemPrize(ctx, { prizeId: body.prizeId, ...(key === null ? {} : { idempotencyKey: key }) })
    if (replayed) setStatus(200)
    return { redemption, balance }
  },
})

export const OPTIONS = preflight
