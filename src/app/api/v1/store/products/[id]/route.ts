import { defineRoute, preflight } from '@/server/api/define-route'
import { storeProductSchema } from '@/server/api/schemas/store'
import { idParams } from '@/server/api/wire'
import { getPublicProduct } from '@/server/domain/store/products'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/store/products/{id}',
  auth: 'key',
  module: 'store',
  summary: 'Um produto à venda. Inativo, arquivado ou de outra conta: 404',
  tag: 'Loja',
  params: idParams('o produto'),
  response: storeProductSchema,
  handler: async ({ ctx, params }) => getPublicProduct(ctx, params.id),
})

export const OPTIONS = preflight
