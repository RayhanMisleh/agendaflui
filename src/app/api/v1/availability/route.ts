import { defineRoute, preflight } from '@/server/api/define-route'
import { availabilitySchema, idListText, splitIds } from '@/server/api/booking-schemas'
import { dateQuery, professionalIdQuery } from '@/server/api/wire'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { getAvailability } from '@/server/domain/scheduling/availability'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/availability',
  auth: 'guest_or_customer',
  summary: 'Horários livres de um dia para os serviços escolhidos (com token de cliente vale o clube)',
  tag: 'Agenda',
  limit: LIMITS.availability,
  query: z.object({ date: dateQuery('Dia local da conta (AAAA-MM-DD).'), serviceIds: idListText, professionalId: professionalIdQuery.optional() }),
  response: availabilitySchema,
  handler: async ({ ctx, query }) =>
    getAvailability(ctx, {
      date: query.date,
      serviceIds: splitIds(query.serviceIds),
      ...(query.professionalId === undefined ? {} : { professionalId: query.professionalId }),
    }),
})

export const OPTIONS = preflight
