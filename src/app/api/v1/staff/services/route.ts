import { defineRoute, preflight } from '@/server/api/define-route'
import { serviceSchema } from '@/server/api/booking-schemas'
import { queryFlag } from '@/server/api/wire'
import { listServices } from '@/server/domain/catalog/services'
import { z } from '@/server/domain/errors'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/services',
  auth: 'staff',
  summary: 'Serviços da conta na ordem de exibição; com includeInactive e includeArchived, também os desativados e arquivados',
  tag: 'Equipe',
  query: z.object({ includeInactive: queryFlag.optional(), includeArchived: queryFlag.optional() }),
  response: z.object({ items: z.array(serviceSchema) }),
  handler: async ({ ctx, query }) => ({ items: await listServices(ctx, query) }),
})

export const OPTIONS = preflight
