import { defineRoute, preflight } from '@/server/api/define-route'
import { hourLabel } from '@/server/api/wire'
import { z } from '@/server/domain/errors'
import { getWeekSchedule, setWeekSchedule, type DayRanges, type WeekSchedule } from '@/server/domain/team/working-hours'
import { minuteLabel, parseMinuteLabel, WEEKDAYS } from '@/server/time'

const rangeIn = z.strictObject({ start: hourLabel, end: hourLabel })
const dayIn = z.array(rangeIn).max(20)

/** Dias que o corpo não traz ficam como estão; o dia enviado (mesmo vazio) substitui o anterior. */
const weekIn = z.strictObject({
  SUNDAY: dayIn.optional(),
  MONDAY: dayIn.optional(),
  TUESDAY: dayIn.optional(),
  WEDNESDAY: dayIn.optional(),
  THURSDAY: dayIn.optional(),
  FRIDAY: dayIn.optional(),
  SATURDAY: dayIn.optional(),
})

const dayOut = z.array(z.object({ start: z.string(), end: z.string(), startMin: z.number(), endMin: z.number() }))
const weekOut = z.object({
  SUNDAY: dayOut,
  MONDAY: dayOut,
  TUESDAY: dayOut,
  WEDNESDAY: dayOut,
  THURSDAY: dayOut,
  FRIDAY: dayOut,
  SATURDAY: dayOut,
})

const toWire = (ranges: DayRanges) =>
  ranges.map((r) => ({ start: minuteLabel(r.startMin), end: minuteLabel(r.endMin), startMin: r.startMin, endMin: r.endMin }))

function weekToWire(week: WeekSchedule) {
  return {
    SUNDAY: toWire(week.SUNDAY),
    MONDAY: toWire(week.MONDAY),
    TUESDAY: toWire(week.TUESDAY),
    WEDNESDAY: toWire(week.WEDNESDAY),
    THURSDAY: toWire(week.THURSDAY),
    FRIDAY: toWire(week.FRIDAY),
    SATURDAY: toWire(week.SATURDAY),
  }
}

const params = z.object({ professionalId: z.string().max(64) })

export const GET = defineRoute({
  method: 'GET',
  path: '/v1/staff/working-hours/{professionalId}',
  auth: 'staff',
  summary: 'Expediente semanal de um profissional, com rótulos HH:mm e minutos desde a meia-noite',
  tag: 'Equipe',
  params,
  response: weekOut,
  handler: async ({ ctx, params: p }) => weekToWire(await getWeekSchedule(ctx, p.professionalId)),
})

export const PUT = defineRoute({
  method: 'PUT',
  path: '/v1/staff/working-hours/{professionalId}',
  auth: 'staff',
  summary: 'Troca os dias enviados do expediente (rótulos HH:mm, o fim pode ser 24:00); os dias que faltam no corpo ficam como estão',
  tag: 'Equipe',
  params,
  body: weekIn,
  response: weekOut,
  handler: async ({ ctx, params: p, body }) => {
    const schedule: Partial<WeekSchedule> = {}
    for (const day of WEEKDAYS) {
      const ranges = body[day]
      if (ranges !== undefined) {
        schedule[day] = ranges.map((r) => ({ startMin: parseMinuteLabel(r.start), endMin: parseMinuteLabel(r.end) }))
      }
    }
    return weekToWire(await setWeekSchedule(ctx, p.professionalId, schedule))
  },
})

export const OPTIONS = preflight
