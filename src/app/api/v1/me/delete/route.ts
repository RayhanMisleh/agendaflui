import { defineRoute, preflight } from '@/server/api/define-route'
import { credentialText } from '@/server/api/auth-schemas'
import { deleteOwnAccount } from '@/server/domain/customers/account'
import { z } from '@/server/domain/errors'

// POST com corpo (e não DELETE): alguns clientes e proxies descartam o corpo de um DELETE.
export const POST = defineRoute({
  method: 'POST',
  path: '/v1/me/delete',
  auth: 'customer',
  status: 204,
  summary: 'Exclui a conta do cliente (confirma com a senha); os dados pessoais são anonimizados',
  tag: 'Conta do cliente',
  body: z.object({ password: credentialText }),
  response: z.undefined(),
  handler: async ({ ctx, body }) => deleteOwnAccount(ctx, body),
})

export const OPTIONS = preflight
