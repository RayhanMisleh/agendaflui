import { defineRoute, preflight } from '@/server/api/define-route'
import { appointmentSchema } from '@/server/api/booking-schemas'
import { idParams, requestInstant } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { rescheduleAppointment } from '@/server/domain/scheduling/appointments'
import { fromIsoInstant } from '@/server/time'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/appointments/{id}/reschedule',
  auth: 'customer',
  summary: 'Remarca um agendamento do cliente para outro horário, dentro do prazo da conta (startsAt em UTC com Z)',
  tag: 'Agendamentos',
  params: idParams('o agendamento'),
  body: z.object({ startsAt: requestInstant, professionalId: z.string().max(64).nullable().optional() }),
  response: appointmentSchema,
  handler: async ({ ctx, params, body }) =>
    rescheduleAppointment(ctx, params.id, {
      startsAt: fromIsoInstant(body.startsAt),
      ...(body.professionalId === undefined ? {} : { professionalId: body.professionalId }),
    }),
})

export const OPTIONS = preflight
