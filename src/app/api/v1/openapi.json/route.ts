import { defineRoute, preflight } from '@/server/api/define-route'
import { buildOpenApi } from '@/server/api/openapi'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/openapi.json',
  auth: 'none',
  summary: 'Documento OpenAPI 3.1 da API, gerado das rotas (a referência para o app)',
  tag: 'Sistema',
  cache: { maxAgeSec: 300 },
  response: z.looseObject({
    openapi: z.string(),
    info: z.looseObject({ title: z.string(), version: z.string() }),
    paths: z.record(z.string(), z.unknown()),
  }),
  handler: async () => buildOpenApi(),
})

export const OPTIONS = preflight
