import { defineRoute, preflight } from '@/server/api/define-route'
import { appointmentSchema } from '@/server/api/booking-schemas'
import { requestInstant } from '@/server/api/wire'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import { bookAppointmentWithOutcome } from '@/server/domain/scheduling/appointments'
import { fromIsoInstant } from '@/server/time'

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/appointments',
  auth: 'customer',
  summary: 'Agendamentos do cliente: próximos (ordem crescente) ou histórico (ordem decrescente), com paginação por cursor',
  tag: 'Agendamentos',
  query: z.object({
    scope: z.enum(['upcoming', 'past']).default('upcoming'),
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  response: z.object({ items: z.array(appointmentSchema), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, query }) =>
    listCustomerAppointments(ctx, {
      scope: query.scope,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    }),
})

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/appointments',
  auth: 'customer',
  status: 201,
  summary:
    'Marca um horário. Com o cabeçalho Idempotency-Key, repetir o mesmo pedido em até 24 h devolve o mesmo agendamento (200)',
  tag: 'Agendamentos',
  body: z.object({
    serviceIds: z.array(z.string()).max(10),
    startsAt: requestInstant,
    professionalId: z.string().max(64).nullable().optional(),
    customerNote: z.string().max(2000).nullable().optional(),
  }),
  response: appointmentSchema,
  limit: LIMITS.booking,
  limitBy: 'subject',
  handler: async ({ ctx, body, request, setStatus }) => {
    const key = request.headers.get('idempotency-key')
    const { appointment, replayed } = await bookAppointmentWithOutcome(ctx, {
      serviceIds: body.serviceIds,
      startsAt: fromIsoInstant(body.startsAt),
      ...(body.professionalId === undefined ? {} : { professionalId: body.professionalId }),
      ...(body.customerNote === undefined ? {} : { customerNote: body.customerNote }),
      ...(key === null ? {} : { idempotencyKey: key }),
    })
    if (replayed) setStatus(200)
    return appointment
  },
})

export const OPTIONS = preflight
