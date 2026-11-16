import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText, tokensSchema } from '@/server/api/auth-schemas'
import { requestMeta } from '@/server/api/request-meta'
import { refreshAppSession } from '@/server/auth/app-session'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/staff/refresh',
  auth: 'key',
  summary: 'Troca o token de renovação da equipe por um par novo',
  tag: 'Conta da equipe',
  body: z.object({ refreshToken: credentialText }),
  response: z.object({ tokens: tokensSchema }),
  handler: async ({ key, body, request, now }) => ({
    tokens: await refreshAppSession('staff', key.businessId, body.refreshToken, requestMeta(request), now),
  }),
})

export const OPTIONS = preflight
