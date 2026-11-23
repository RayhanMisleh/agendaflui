import { defineRoute, preflight } from '@/server/api/define-route'
import { storeCategorySchema } from '@/server/api/schemas/store'
import { z } from '@/server/domain/errors'
import { listCategories } from '@/server/domain/store/categories'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/store/categories',
  auth: 'guest',
  module: 'store',
  summary: 'Categorias de produtos, na ordem da loja, com a contagem de produtos à venda',
  tag: 'Loja',
  response: z.object({ items: z.array(storeCategorySchema) }),
  handler: async ({ ctx }) => ({ items: (await listCategories(ctx)).map((c) => ({ id: c.id, name: c.name, productCount: c.productCount })) }),
})

export const OPTIONS = preflight
