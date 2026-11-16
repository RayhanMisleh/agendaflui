import { runAfterResponse } from '@/server/api/after'
import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText, verificationSentSchema } from '@/server/api/auth-schemas'
import { requestMeta } from '@/server/api/request-meta'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { requestRegistration } from '@/server/domain/customers/account'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/customer/register',
  auth: 'key',
  summary: 'Pede o cadastro de um cliente e envia o código de confirmação por e-mail',
  tag: 'Conta do cliente',
  body: z.object({ name: credentialText, email: credentialText, phone: credentialText.nullable().optional(), password: credentialText }),
  response: verificationSentSchema,
  status: 202,
  limit: LIMITS.authIp,
  handler: async ({ key, body, request, now }) => {
    runAfterResponse(await requestRegistration(key.businessId, body, requestMeta(request), now))
    return { status: 'verification_sent' as const }
  },
})

export const OPTIONS = preflight
