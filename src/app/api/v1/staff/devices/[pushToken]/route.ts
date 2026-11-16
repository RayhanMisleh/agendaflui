import { defineRoute, preflight } from '@/server/api/define-route'
import { pushTokenSchema, removeDevice } from '@/server/domain/customers/devices'
import { z } from '@/server/domain/errors'

export const DELETE = defineRoute({
  method: 'DELETE',
  path: '/v1/staff/devices/{pushToken}',
  auth: 'staff',
  status: 204,
  summary: 'Remove o aparelho da equipe; token que não é dela não muda nada (e não revela de quem é)',
  tag: 'Conta da equipe',
  params: z.object({ pushToken: pushTokenSchema }),
  response: z.undefined(),
  handler: async ({ ctx, params }) => removeDevice(ctx, params.pushToken),
})

export const OPTIONS = preflight
