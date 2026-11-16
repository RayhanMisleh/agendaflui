import { defineRoute, preflight } from '@/server/api/define-route'
import { appointmentSchema } from '@/server/api/booking-schemas'
import { z } from '@/server/domain/errors'
import { getAppointment } from '@/server/domain/scheduling/appointments'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/appointments/{id}',
  auth: 'customer',
  summary: 'Um agendamento do cliente (de outro cliente: 404)',
  tag: 'Agendamentos',
  params: z.object({ id: z.uuid() }),
  response: appointmentSchema,
  handler: async ({ ctx, params }) => getAppointment(ctx, params.id),
})

export const OPTIONS = preflight
