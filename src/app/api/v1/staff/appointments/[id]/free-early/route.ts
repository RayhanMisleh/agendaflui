import { defineRoute, preflight } from '@/server/api/define-route'
import { idParams } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { notifyProfessionalFreeEarly } from '@/server/domain/notifications/outbox'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments/{id}/free-early',
  auth: 'staff',
  status: 204,
  summary: 'Avisa o cliente de que o profissional já está livre (agendamento confirmado de hoje, ainda não iniciado); repetir não avisa de novo',
  tag: 'Agenda da equipe',
  params: idParams('o agendamento'),
  response: z.undefined(),
  handler: async ({ ctx, params }) => notifyProfessionalFreeEarly(ctx, params.id),
})

export const OPTIONS = preflight
