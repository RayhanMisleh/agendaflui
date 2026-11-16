import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText } from '@/server/api/auth-schemas'
import { changePassword } from '@/server/domain/customers/account'
import { z } from '@/server/domain/errors'

export const PUT = defineRoute({
  method: 'PUT',
  path: '/v1/me/password',
  auth: 'customer',
  status: 204,
  summary: 'Troca a senha do cliente (confere a atual); encerra as outras sessões',
  tag: 'Conta do cliente',
  body: z.object({ current: credentialText, next: credentialText }),
  response: z.undefined(),
  handler: async ({ ctx, body }) => changePassword(ctx, body),
})

export const OPTIONS = preflight
