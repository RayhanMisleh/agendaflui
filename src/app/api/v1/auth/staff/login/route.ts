import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText, staffLoginBusinessSchema, staffMemberSchema, tokensSchema } from '@/server/api/auth-schemas'
import { requestMeta } from '@/server/api/request-meta'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { loginStaff } from '@/server/auth/staff-app-auth'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/auth/staff/login',
  auth: 'none',
  summary: 'Entrada da equipe (dono, gerente ou profissional) com e-mail e senha, sem escolher a loja',
  tag: 'Conta da equipe',
  body: z.object({ email: credentialText, password: credentialText }),
  response: z.object({ tokens: tokensSchema, member: staffMemberSchema, business: staffLoginBusinessSchema }),
  limit: LIMITS.authIp,
  handler: async ({ body, request, now }) => {
    // Sem `X-Business`: a loja vem do vínculo ativo do usuário (se o cabeçalho vier, é ignorado).
    const s = await loginStaff(body, requestMeta(request), now)
    return { tokens: s.pair, member: s.member, business: s.business }
  },
})

export const OPTIONS = preflight
