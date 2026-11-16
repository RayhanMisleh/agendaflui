import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentPageSchema } from '@/server/api/schemas/staff'
import { idParams, listScope, pageCursor, pageLimit } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/customers/{id}/appointments',
  auth: 'staff',
  summary: 'Agendamentos de um cliente: próximos (ordem crescente) ou histórico (ordem decrescente), com paginação por cursor',
  tag: 'Clientes da equipe',
  params: idParams('o cliente'),
  query: z.object({
    scope: listScope,
    cursor: pageCursor.optional(),
    limit: pageLimit(50, 20),
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
