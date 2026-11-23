import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText } from '@/server/api/auth-schemas'
import { requestMeta } from '@/server/api/request-meta'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { resetPassword } from '@/server/domain/customers/account'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/customer/password/reset',
  auth: 'guest',
  summary: 'Define a senha nova com o código recebido por e-mail',
  tag: 'Conta do cliente',
  body: z.object({ email: credentialText, code: credentialText, password: credentialText }),
  response: z.undefined(),
  status: 204,
  limit: LIMITS.authIp,
  handler: async ({ business, body, request, now }) => {
    await resetPassword(business.id, body, requestMeta(request), now)
    return undefined
  },
})

export const OPTIONS = preflight
