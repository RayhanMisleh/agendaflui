import { defineRoute, preflight } from '@/server/api/define-route'
import { rankingSchema } from '@/server/api/schemas/loyalty'
import { getRanking } from '@/server/domain/loyalty/ranking'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/loyalty/ranking',
  auth: 'key_or_customer',
  module: 'loyalty',
  summary: 'Ranking do mês (pontos ganhos, 10 primeiros, só o primeiro nome). Desligado: `enabled: false` e lista vazia',
  tag: 'Fidelidade',
  response: rankingSchema,
  handler: async ({ ctx }) => getRanking(ctx),
})

export const OPTIONS = preflight
