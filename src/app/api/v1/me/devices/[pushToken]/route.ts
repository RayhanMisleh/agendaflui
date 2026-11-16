import { defineRoute, preflight } from '@/server/api/define-route'
import { removeDevice, pushTokenSchema } from '@/server/domain/customers/devices'
import { z } from '@/server/domain/errors'

export const DELETE = defineRoute({
  method: 'DELETE',
  path: '/v1/me/devices/{pushToken}',
  auth: 'customer',
  status: 204,
  summary: 'Remove o aparelho do cliente; token que não é dele não muda nada (e não revela de quem é)',
  tag: 'Conta do cliente',
  params: z.object({ pushToken: pushTokenSchema }),
  response: z.undefined(),
  handler: async ({ ctx, params }) => removeDevice(ctx, params.pushToken),
})

export const OPTIONS = preflight
