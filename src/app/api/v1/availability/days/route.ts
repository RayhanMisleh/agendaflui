import { defineRoute, preflight } from '@/server/api/define-route'
import { availableDaySchema, idListText, splitIds } from '@/server/api/booking-schemas'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { listAvailableDays } from '@/server/domain/scheduling/availability'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/availability/days',
  auth: 'key_or_customer',
  summary: 'Quais dias de um intervalo (até 31 dias) têm horário livre para os serviços escolhidos',
  tag: 'Agenda',
  limit: LIMITS.availability,
  query: z.object({
    from: z.string().max(10),
    to: z.string().max(10),
    serviceIds: idListText,
    professionalId: z.string().max(64).optional(),
  }),
  response: z.object({ items: z.array(availableDaySchema) }),
  handler: async ({ ctx, query }) => ({
    items: await listAvailableDays(ctx, {
      from: query.from,
      to: query.to,
      serviceIds: splitIds(query.serviceIds),
      ...(query.professionalId === undefined ? {} : { professionalId: query.professionalId }),
    }),
  }),
})

export const OPTIONS = preflight
