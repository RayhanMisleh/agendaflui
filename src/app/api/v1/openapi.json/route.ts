import { defineRoute, preflight } from '@/server/api/define-route'
import { z } from '@/server/domain/errors'

// Esqueleto: a Tarefa 11 gera o documento a partir das rotas registradas.
export const GET = defineRoute({
  method: 'GET',
  path: '/v1/openapi.json',
  auth: 'none',
  summary: 'Documento OpenAPI da API',
  tag: 'Sistema',
  response: z.object({ openapi: z.string() }),
  handler: async () => ({ openapi: '3.1.0' }),
})

export const OPTIONS = preflight
