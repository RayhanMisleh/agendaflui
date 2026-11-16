import { defineRoute, preflight } from '@/server/api/define-route'
import { dateQuery, professionalIdQuery } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { getDaySummary } from '@/server/domain/scheduling/agenda'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/summary',
  auth: 'staff',
  summary: 'Resumo do dia: agendamentos por situação, minutos marcados e de expediente, faturamento e ocupação',
  tag: 'Agenda da equipe',
  query: z.object({ date: dateQuery('Dia local da conta (AAAA-MM-DD).'), professionalId: professionalIdQuery.optional() }),
  response: z.object({
    total: z.number(),
    byStatus: z.object({
      PENDING: z.number(),
      CONFIRMED: z.number(),
      COMPLETED: z.number(),
      CANCELED: z.number(),
      NO_SHOW: z.number(),
    }),
    bookedMinutes: z.number(),
    workingMinutes: z.number(),
    revenueCents: z.number(),
    occupancy: z.number().nullable(),
  }),
  handler: async ({ ctx, query }) => getDaySummary(ctx, query.date, query.professionalId),
})

export const OPTIONS = preflight
