import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { idParams } from '@/server/api/wire'
import { confirmAppointment } from '@/server/domain/scheduling/appointment-status-ops'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/confirm',
  auth: 'staff',
  summary: 'Confirma um agendamento pendente',
  tag: 'Agenda da equipe',
  params: idParams('o agendamento'),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params }) => staffAppointment(await confirmAppointment(ctx, params.id)),
})

export const OPTIONS = preflight
