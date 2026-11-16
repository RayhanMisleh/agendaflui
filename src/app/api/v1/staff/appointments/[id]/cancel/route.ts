import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { idParams } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { cancelAppointment } from '@/server/domain/scheduling/appointment-status-ops'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/cancel',
  auth: 'staff',
  summary: 'Cancela um agendamento pendente ou confirmado, sem prazo; envie {} quando não houver motivo',
  tag: 'Agenda da equipe',
  params: idParams('o agendamento'),
  body: z.object({ reason: z.string().max(300).nullable().optional() }),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params, body }) =>
    staffAppointment(await cancelAppointment(ctx, params.id, body.reason === undefined ? {} : { reason: body.reason })),
})

export const OPTIONS = preflight
