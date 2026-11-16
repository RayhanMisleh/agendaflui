import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { z } from '@/server/domain/errors'
import { completeAppointment } from '@/server/domain/scheduling/appointment-status-ops'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/complete',
  auth: 'staff',
  summary: 'Conclui o atendimento (só depois do horário de início) e calcula a comissão',
  tag: 'Agenda da equipe',
  params: z.object({ id: z.uuid() }),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params }) => staffAppointment(await completeAppointment(ctx, params.id)),
})

export const OPTIONS = preflight
