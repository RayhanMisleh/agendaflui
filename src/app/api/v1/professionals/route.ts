import { defineRoute, preflight } from '@/server/api/define-route'
import { idListText, professionalSchema, splitIds } from '@/server/api/booking-schemas'
import { z } from '@/server/domain/errors'
import { listProfessionals } from '@/server/domain/team/professionals'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/professionals',
  auth: 'guest',
  summary: 'Profissionais ativos; com serviceIds (separados por vírgula), só os que fazem todos esses serviços',
  tag: 'Catálogo',
  query: z.object({ serviceIds: idListText.optional() }),
  response: z.object({ items: z.array(professionalSchema) }),
  handler: async ({ ctx, query }) => ({
    items: await listProfessionals(ctx, query.serviceIds === undefined ? {} : { serviceIds: splitIds(query.serviceIds) }),
  }),
})

export const OPTIONS = preflight
