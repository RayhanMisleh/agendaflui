import { defineRoute, preflight } from '@/server/api/define-route'
import { staffAppointment, staffAppointmentSchema } from '@/server/api/schemas/staff'
import { dateQuery, isoInstant, professionalIdQuery, uuid } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { getAgenda } from '@/server/domain/scheduling/agenda'

const weekday = z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'])

const agendaDaySchema = z.object({
  date: z.string(),
  weekday,
  closed: z.boolean(),
  closureReason: z.string().nullable(),
  professionals: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      active: z.boolean(),
      archived: z.boolean(),
      workingRanges: z.array(z.object({ startMin: z.number(), endMin: z.number(), startLabel: z.string(), endLabel: z.string() })),
      appointments: z.array(staffAppointmentSchema),
      blocks: z.array(
        z.object({
          id: uuid,
          professionalId: uuid,
          startsAt: isoInstant,
          endsAt: isoInstant,
          reason: z.string().nullable(),
          local: z.object({ start: z.string(), end: z.string() }),
        }),
      ),
    }),
  ),
})

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/agenda',
  auth: 'staff',
  summary: 'Agenda por dia e por profissional (até 31 dias); quem não vê todas as agendas recebe só a própria coluna',
  tag: 'Agenda da equipe',
  query: z.object({
    from: dateQuery('Primeiro dia local da conta (AAAA-MM-DD).'),
    to: dateQuery('Último dia local da conta (AAAA-MM-DD), no máximo 31 dias depois do primeiro.'),
    professionalId: professionalIdQuery.optional(),
  }),
  response: z.object({ days: z.array(agendaDaySchema) }),
  handler: async ({ ctx, query }) => {
    const days = await getAgenda(ctx, {
      from: query.from,
      to: query.to,
      ...(query.professionalId === undefined ? {} : { professionalId: query.professionalId }),
    })
    return {
      days: days.map((day) => ({
        ...day,
        professionals: day.professionals.map((p) => ({ ...p, appointments: p.appointments.map(staffAppointment) })),
      })),
    }
  },
})

export const OPTIONS = preflight
