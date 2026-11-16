import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText, customerSessionSchema } from '@/server/api/auth-schemas'
import { requestMeta } from '@/server/api/request-meta'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { confirmRegistration } from '@/server/domain/customers/account'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/customer/verify',
  auth: 'key',
  summary: 'Confirma o cadastro com o código recebido por e-mail e entra',
  tag: 'Conta do cliente',
  body: z.object({ email: credentialText, code: credentialText }),
  response: customerSessionSchema,
  limit: LIMITS.authIp,
  handler: async ({ key, body, request, now }) => {
    const s = await confirmRegistration(key.businessId, body, requestMeta(request), now)
    return { tokens: s.pair, customer: s.customer }
  },
})

export const OPTIONS = preflight
