import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { idParams } from '@/server/api/wire'
import { undoOutcome } from '@/server/domain/scheduling/appointment-status-ops'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/undo',
  auth: 'staff',
  summary: 'Desfaz a conclusão ou a falta e volta o agendamento a confirmado',
  tag: 'Agenda da equipe',
  params: idParams('o agendamento'),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params }) => staffAppointment(await undoOutcome(ctx, params.id)),
})

export const OPTIONS = preflight
