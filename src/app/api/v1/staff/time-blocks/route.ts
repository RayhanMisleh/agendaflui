import { defineRoute, preflight } from '@/server/api/define-route'
import { hourLabel, isoInstant, localDate, uuid } from '@/server/api/wire'
import type { TenantContext } from '@/server/auth/actor'
import { DomainError, z } from '@/server/domain/errors'
import { createTimeBlock, listTimeBlocks, type TimeBlockView } from '@/server/domain/team/time-blocks'
import { localParts, minuteToInstant, minutesBetween, parseMinuteLabel } from '@/server/time'

const timeBlockSchema = z.object({
  id: uuid,
  professionalId: uuid,
  startsAt: isoInstant,
  endsAt: isoInstant,
  reason: z.string().nullable(),
  local: z.object({ startDate: z.string(), startTime: z.string(), endDate: z.string(), endTime: z.string() }),
})

/** O bloqueio com as datas e horas locais da conta já prontas (o app não faz conta de fuso). */
function withLocal(ctx: TenantContext, block: TimeBlockView) {
  const start = localParts(block.startsAt, ctx.timeZone)
  const end = localParts(block.endsAt, ctx.timeZone)
  return { ...block, local: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time } }
}

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/time-blocks',
  auth: 'staff',
  summary: 'Bloqueios de um profissional que tocam o intervalo de datas locais (até 92 dias); o motivo só aparece para o dono da ficha e para quem vê todas as agendas',
  tag: 'Equipe',
  query: z.object({ professionalId: z.string().max(64), from: z.string().max(10), to: z.string().max(10) }),
  response: z.object({ items: z.array(timeBlockSchema) }),
  handler: async ({ ctx, query }) => ({
    items: (await listTimeBlocks(ctx, query)).map((block) => withLocal(ctx, block)),
  }),
})

export const POST = defineRoute({
  method: 'POST',
  path: '/v1/staff/time-blocks',
  auth: 'staff',
  status: 201,
  summary:
    'Bloqueia a agenda de um profissional em datas e horas locais da conta (endDate vale startDate quando falta; endTime aceita 24:00). Devolve quantos agendamentos abertos o bloqueio cobre; ele não os cancela',
  tag: 'Equipe',
  body: z.object({
    professionalId: z.string().max(64),
    startDate: localDate,
    startTime: hourLabel.refine((hora) => hora !== '24:00', 'O início deve ser antes de 24:00.'),
    endDate: localDate.optional(),
    endTime: hourLabel,
    reason: z.string().max(200).nullable().optional(),
  }),
  response: z.object({ ...timeBlockSchema.shape, affectedAppointments: z.number() }),
  handler: async ({ ctx, body }) => {
    const startsAt = minuteToInstant(body.startDate, parseMinuteLabel(body.startTime), ctx.timeZone)
    const endsAt = minuteToInstant(body.endDate ?? body.startDate, parseMinuteLabel(body.endTime), ctx.timeZone)
    if (minutesBetween(startsAt, endsAt) <= 0) {
      const message = 'O fim do bloqueio deve ser depois do início.'
      throw new DomainError('validation', message, { fields: { endTime: message } })
    }
    const created = await createTimeBlock(ctx, {
      professionalId: body.professionalId,
      startsAt,
      endsAt,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    })
    return { ...withLocal(ctx, created), affectedAppointments: created.affectedAppointments }
  },
})

export const OPTIONS = preflight
