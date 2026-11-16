import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { z } from '@/server/domain/errors'
import { adjustAppointment } from '@/server/domain/scheduling/appointments'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/adjust',
  auth: 'staff',
  summary: 'Ajusta o valor (só quem vê todas as agendas) e a anotação interna de um agendamento aberto',
  tag: 'Agenda da equipe',
  params: z.object({ id: z.uuid() }),
  body: z.object({ totalCents: z.number().optional(), notes: z.string().max(2000).nullable().optional() }),
  response: staffAppointmentSchema,
  handler: async ({ ctx, params, body }) =>
    staffAppointment(
      await adjustAppointment(ctx, params.id, {
        ...(body.totalCents === undefined ? {} : { totalCents: body.totalCents }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
      }),
    ),
})

export const OPTIONS = preflight
