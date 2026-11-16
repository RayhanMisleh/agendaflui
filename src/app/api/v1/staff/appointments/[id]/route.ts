import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { idParams } from '@/server/api/wire'
import { getAppointment } from '@/server/domain/scheduling/appointments'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/appointments/{id}',
  auth: 'staff',
  summary: 'Um agendamento, com comissão e anotação interna quando quem lê é dono da agenda ou vê todas',
  tag: 'Agenda da equipe',
  params: idParams('o agendamento'),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params }) => staffAppointment(await getAppointment(ctx, params.id)),
})

export const OPTIONS = preflight
