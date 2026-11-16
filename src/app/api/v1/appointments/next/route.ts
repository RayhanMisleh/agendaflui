import { defineRoute, preflight } from '@/server/api/define-route'
import { appointmentSchema } from '@/server/api/booking-schemas'
import { z } from '@/server/domain/errors'
import { getNextAppointment } from '@/server/domain/scheduling/agenda'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/appointments/next',
  auth: 'customer',
  summary: 'Próximo agendamento do cliente (appointment nulo quando não há)',
  tag: 'Agendamentos',
  response: z.object({ appointment: appointmentSchema.nullable() }),
  handler: async ({ ctx }) => ({ appointment: await getNextAppointment(ctx) }),
})

export const OPTIONS = preflight
