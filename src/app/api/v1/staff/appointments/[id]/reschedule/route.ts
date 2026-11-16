import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { requestInstant } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { rescheduleAppointment } from '@/server/domain/scheduling/appointments'
import { fromIsoInstant } from '@/server/time'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/reschedule',
  auth: 'staff',
  summary: 'Remarca um agendamento aberto para outro horário e, se quiser, outro profissional. Instantes de entrada: só UTC com Z',
  tag: 'Agenda da equipe',
  params: z.object({ id: z.uuid() }),
  body: z.object({ startsAt: requestInstant, professionalId: z.string().max(64).nullable().optional() }),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params, body }) =>
    staffAppointment(
      await rescheduleAppointment(ctx, params.id, {
        startsAt: fromIsoInstant(body.startsAt),
        ...(body.professionalId === undefined ? {} : { professionalId: body.professionalId }),
      }),
    ),
})

export const OPTIONS = preflight
