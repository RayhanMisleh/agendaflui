import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText } from '@/server/api/auth-schemas'
import { logoutAppSession } from '@/server/auth/app-session'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/staff/logout',
  auth: 'key',
  summary: 'Sai do app da equipe: revoga a sessão do token de renovação',
  tag: 'Conta da equipe',
  body: z.object({ refreshToken: credentialText }),
  response: z.undefined(),
  status: 204,
  limit: LIMITS.authIp,
  handler: async ({ key, body, now }) => {
    await logoutAppSession('staff', key.businessId, body.refreshToken, now)
    return undefined
  },
})

export const OPTIONS = preflight
