import { defineRoute, preflight } from '@/server/api/define-route'
import { storeProductSchema } from '@/server/api/schemas/store'
import { pageCursor, pageLimit } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { listPublicProducts } from '@/server/domain/store/products'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/store/products',
  auth: 'key',
  module: 'store',
  summary: 'Produtos à venda (ativos, de categoria não arquivada), na ordem da loja, com paginação por cursor. O estoque não é exposto',
  tag: 'Loja',
  query: z.object({
    categoryId: z.string().max(64).optional().describe('Só os produtos desta categoria.'),
    search: z.string().max(100).optional().describe('Parte do nome do produto.'),
    cursor: pageCursor.optional(),
    limit: pageLimit(50, 20),
  }),
  response: z.object({ items: z.array(storeProductSchema), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, query }) =>
    listPublicProducts(ctx, {
      limit: query.limit,
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    }),
})

export const OPTIONS = preflight
