import { defineRoute, preflight } from '@/server/api/define-route'
import { serviceSchema } from '@/server/api/booking-schemas'
import { z } from '@/server/domain/errors'
import { listServices } from '@/server/domain/catalog/services'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/services',
  auth: 'guest',
  summary: 'Serviços ativos da conta, na ordem de exibição',
  tag: 'Catálogo',
  response: z.object({ items: z.array(serviceSchema) }),
  handler: async ({ ctx }) => ({ items: await listServices(ctx) }),
})

export const OPTIONS = preflight
