import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { idParams } from '@/server/api/wire'
import { markNoShow } from '@/server/domain/scheduling/appointment-status-ops'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/no-show',
  auth: 'staff',
  summary: 'Marca a falta do cliente (só depois do horário de início)',
  tag: 'Agenda da equipe',
  params: idParams('o agendamento'),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params }) => staffAppointment(await markNoShow(ctx, params.id)),
})

export const OPTIONS = preflight
