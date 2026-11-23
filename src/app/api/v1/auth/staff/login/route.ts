import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText, staffMemberSchema, tokensSchema } from '@/server/api/auth-schemas'
import { requestMeta } from '@/server/api/request-meta'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { loginStaff } from '@/server/auth/staff-app-auth'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/staff/login',
  auth: 'guest',
  summary: 'Entrada da equipe (dono, gerente ou profissional) com e-mail e senha',
  tag: 'Conta da equipe',
  body: z.object({ email: credentialText, password: credentialText }),
  response: z.object({ tokens: tokensSchema, member: staffMemberSchema }),
  limit: LIMITS.authIp,
  handler: async ({ business, body, request, now }) => {
    const s = await loginStaff(business.id, body, requestMeta(request), now)
    return { tokens: s.pair, member: s.member }
  },
})

export const OPTIONS = preflight
