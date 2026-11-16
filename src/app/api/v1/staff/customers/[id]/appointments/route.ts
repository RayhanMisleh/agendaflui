import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentPageSchema } from '@/server/api/schemas/staff'
import { z } from '@/server/domain/errors'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/customers/{id}/appointments',
  auth: 'staff',
  summary: 'Agendamentos de um cliente: próximos (ordem crescente) ou histórico (ordem decrescente), com paginação por cursor',
  tag: 'Clientes da equipe',
  params: z.object({ id: z.uuid() }),
  query: z.object({
    scope: z.enum(['upcoming', 'past']).default('upcoming'),
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  response: staffAppointmentPageSchema,
  handler: async ({ ctx, params, query }) => {
    const page = await listCustomerAppointments(ctx, {
      customerId: params.id,
      scope: query.scope,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    })
    return { items: page.items.map(staffAppointment), nextCursor: page.nextCursor }
  },
})

export const OPTIONS = preflight
