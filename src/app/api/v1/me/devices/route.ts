import { defineRoute, preflight } from '@/server/api/define-route'
import { registerDevice, registerDeviceSchema } from '@/server/domain/customers/devices'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/me/devices',
  auth: 'customer',
  status: 204,
  summary: 'Registra o aparelho para notificações; o mesmo token passa ao último cliente que o registrou',
  tag: 'Conta do cliente',
  body: registerDeviceSchema,
  response: z.undefined(),
  handler: async ({ ctx, body }) => registerDevice(ctx, body),
})

export const OPTIONS = preflight
