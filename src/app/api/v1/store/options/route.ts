import { defineRoute, preflight } from '@/server/api/define-route'
import { storeOptionsSchema } from '@/server/api/schemas/store'
import { getStoreOptions } from '@/server/domain/store/settings'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/store/options',
  auth: 'guest',
  module: 'store',
  summary: 'O que a loja oferece: retirada no local (com as instruções), entrega e pagamento disponíveis',
  tag: 'Loja',
  response: storeOptionsSchema,
  handler: async ({ ctx }) => getStoreOptions(ctx),
})

export const OPTIONS = preflight
