import { defineRoute, preflight } from '@/server/api/define-route'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/health',
  auth: 'none',
  summary: 'Confere se a API está no ar',
  tag: 'Sistema',
  response: z.object({ status: z.literal('ok') }),
  handler: async () => ({ status: 'ok' as const }),
})

export const OPTIONS = preflight
