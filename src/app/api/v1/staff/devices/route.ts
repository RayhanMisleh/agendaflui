import { defineRoute, preflight } from '@/server/api/define-route'
import { registerDevice, registerDeviceSchema } from '@/server/domain/customers/devices'
import { z } from '@/server/domain/errors'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/devices',
  auth: 'staff',
  status: 204,
  summary: 'Registra o aparelho da equipe para notificações; o mesmo token passa ao último que o registrou',
  tag: 'Conta da equipe',
  body: registerDeviceSchema,
  response: z.undefined(),
  handler: async ({ ctx, body }) => registerDevice(ctx, body),
})

export const OPTIONS = preflight
