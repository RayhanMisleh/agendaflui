import { defineRoute, preflight } from '@/server/api/define-route'
import { availabilitySchema, idListText, splitIds } from '@/server/api/booking-schemas'
import { z } from '@/server/domain/errors'
import { getAvailability } from '@/server/domain/scheduling/availability'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/availability',
  auth: 'key_or_customer',
  summary: 'Horários livres de um dia para os serviços escolhidos (com token de cliente vale o clube)',
  tag: 'Agenda',
  query: z.object({ date: z.string().max(10), serviceIds: idListText, professionalId: z.string().max(64).optional() }),
  response: availabilitySchema,
  handler: async ({ ctx, query }) =>
    getAvailability(ctx, {
      date: query.date,
      serviceIds: splitIds(query.serviceIds),
      ...(query.professionalId === undefined ? {} : { professionalId: query.professionalId }),
    }),
})

export const OPTIONS = preflight
