import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText } from '@/server/api/auth-schemas'
import { logoutAppSession } from '@/server/auth/app-session'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/customer/logout',
  auth: 'guest',
  summary: 'Sai do app: revoga a sessão do token de renovação',
  tag: 'Conta do cliente',
  body: z.object({ refreshToken: credentialText }),
  response: z.undefined(),
  status: 204,
  handler: async ({ business, body, now }) => {
    await logoutAppSession('customer', business.id, body.refreshToken, now)
    return undefined
  },
})

export const OPTIONS = preflight
