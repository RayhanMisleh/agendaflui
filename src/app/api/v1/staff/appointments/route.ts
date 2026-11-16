import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { requestInstant } from '@/server/api/wire'
import { LIMITS } from '@/server/auth/rate-limit-db'
import { z } from '@/server/domain/errors'
import { bookAppointmentWithOutcome } from '@/server/domain/scheduling/appointments'
import { fromIsoInstant } from '@/server/time'

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/appointments',
  auth: 'staff',
  status: 201,
  alternateStatuses: [200],
  summary:
    'Marca um horário para um cliente, mesmo fora da grade (só não pode sobrepor outro agendamento nem bloqueio). Com o cabeçalho Idempotency-Key, repetir o mesmo pedido em até 24 h devolve o mesmo agendamento (200). Instantes de entrada: só UTC com Z',
  tag: 'Agenda da equipe',
  body: z.object({
    customerId: z.string().max(64),
    serviceIds: z.array(z.string()).max(10),
    startsAt: requestInstant,
    professionalId: z.string().max(64).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }),
  response: staffAppointmentSchema,
  limit: LIMITS.booking,
  limitBy: 'subject',
  handler: async ({ ctx, body, request, setStatus }) => {
    const key = request.headers.get('idempotency-key')
    const { appointment, replayed } = await bookAppointmentWithOutcome(ctx, {
      customerId: body.customerId,
      serviceIds: body.serviceIds,
      startsAt: fromIsoInstant(body.startsAt),
      ...(body.professionalId === undefined ? {} : { professionalId: body.professionalId }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
      ...(key === null ? {} : { idempotencyKey: key }),
    })
    if (replayed) setStatus(200)
    return staffAppointment(appointment)
  },
})

export const OPTIONS = preflight
