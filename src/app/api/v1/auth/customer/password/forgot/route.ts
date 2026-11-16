import { runAfterResponse } from '@/server/api/after'
import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText, verificationSentSchema } from '@/server/api/auth-schemas'
import { requestMeta } from '@/server/api/request-meta'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { requestPasswordReset } from '@/server/domain/customers/account'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/customer/password/forgot',
  auth: 'key',
  summary: 'Pede o código para redefinir a senha (a resposta é sempre a mesma)',
  tag: 'Conta do cliente',
  body: z.object({ email: credentialText }),
  response: verificationSentSchema,
  status: 202,
  limit: LIMITS.authIp,
  handler: async ({ key, body, request, now }) => {
    runAfterResponse(await requestPasswordReset(key.businessId, body.email, requestMeta(request), now))
    return { status: 'verification_sent' as const }
  },
})

export const OPTIONS = preflight
