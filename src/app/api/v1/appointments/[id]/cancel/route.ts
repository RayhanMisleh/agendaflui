import { defineRoute, preflight } from '@/server/api/define-route'
import { appointmentSchema } from '@/server/api/booking-schemas'
import { z } from '@/server/domain/errors'
import { cancelAppointment } from '@/server/domain/scheduling/appointments'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/appointments/{id}/cancel',
  auth: 'customer',
  summary: 'Cancela um agendamento do cliente, dentro do prazo da conta',
  tag: 'Agendamentos',
  params: z.object({ id: z.uuid() }),
  response: appointmentSchema,
  handler: async ({ ctx, params }) => cancelAppointment(ctx, params.id),
})

export const OPTIONS = preflight
