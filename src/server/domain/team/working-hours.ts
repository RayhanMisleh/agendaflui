import type { TenantContext } from '@/server/auth/actor'
import { audit } from '@/server/domain/audit'
import { DomainError, parse, z } from '@/server/domain/errors'
import { assertCanReadSchedule, assertCanWriteSchedule } from '@/server/domain/team/professionals'
import { WEEKDAYS, type Weekday } from '@/server/time'

export type DayRanges = { startMin: number; endMin: number }[]
export type WeekSchedule = Record<Weekday, DayRanges>

const MAX_RANGES_PER_DAY = 6

const rangeSchema = z
  .object({
    startMin: z
      .number()
      .int('Informe o horário em minutos inteiros.')
      .min(0, 'O início não pode ser antes de 00:00.')
      .max(1435, 'O início deve ser antes de 24:00.')
      .multipleOf(5, 'Use horários de 5 em 5 minutos.'),
    endMin: z
      .number()
      .int('Informe o horário em minutos inteiros.')
      .min(5, 'O fim deve ser depois de 00:00.')
      .max(1440, 'O fim não pode ser depois de 24:00.')
      .multipleOf(5, 'Use horários de 5 em 5 minutos.'),
  })
  .refine((r) => r.startMin < r.endMin, { message: 'O fim deve ser depois do início.', path: ['endMin'] })

const daySchema = z.array(rangeSchema).max(MAX_RANGES_PER_DAY, `Use no máximo ${MAX_RANGES_PER_DAY} intervalos por dia.`)

const scheduleSchema = z.strictObject({
  SUNDAY: daySchema.optional(),
  MONDAY: daySchema.optional(),
  TUESDAY: daySchema.optional(),
  WEDNESDAY: daySchema.optional(),
  THURSDAY: daySchema.optional(),
  FRIDAY: daySchema.optional(),
  SATURDAY: daySchema.optional(),
})

function emptyWeek(): WeekSchedule {
  return {
    SUNDAY: [],
    MONDAY: [],
    TUESDAY: [],
    WEDNESDAY: [],
    THURSDAY: [],
    FRIDAY: [],
    SATURDAY: [],
  }
}

async function loadWeek(ctx: TenantContext, professionalId: string): Promise<WeekSchedule> {
  const rows = await ctx.db.workingHours.findMany({
    where: { professionalId },
    orderBy: [{ startMin: 'asc' }, { endMin: 'asc' }, { id: 'asc' }],
  })
  const week = emptyWeek()
  for (const row of rows) week[row.weekday].push({ startMin: row.startMin, endMin: row.endMin })
  return week
}

export async function getWeekSchedule(ctx: TenantContext, professionalId: string): Promise<WeekSchedule> {
  await assertCanReadSchedule(ctx, professionalId)
  return loadWeek(ctx, professionalId)
}

/** Troca os dias informados; os demais ficam como estão. Intervalos que se encostam são aceitos. */
export async function setWeekSchedule(
  ctx: TenantContext,
  professionalId: string,
  schedule: Partial<WeekSchedule>,
): Promise<WeekSchedule> {
  await assertCanWriteSchedule(ctx, professionalId)
  const parsed = parse(scheduleSchema, schedule)
  const days: { weekday: Weekday; ranges: DayRanges }[] = []
  for (const weekday of WEEKDAYS) {
    const ranges = parsed[weekday]
    if (ranges === undefined) continue
    const sorted = [...ranges].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1]
      const current = sorted[i]
      if (previous && current && current.startMin < previous.endMin) {
        throw new DomainError('validation', 'Há intervalos que se sobrepõem no mesmo dia. Ajuste os horários.', {
          fields: { [weekday]: 'Os intervalos do mesmo dia não podem se sobrepor.' },
        })
      }
    }
    days.push({ weekday, ranges: sorted })
  }
  if (days.length > 0) {
    await ctx.db.$transaction(async (tx) => {
      await tx.workingHours.deleteMany({
        where: { professionalId, weekday: { in: days.map((d) => d.weekday) } },
      })
      const data = days.flatMap((d) =>
        d.ranges.map((r) => ({
          businessId: ctx.businessId,
          professionalId,
          weekday: d.weekday,
          startMin: r.startMin,
          endMin: r.endMin,
        })),
      )
      if (data.length > 0) await tx.workingHours.createMany({ data })
      await audit(
        ctx,
        {
          action: 'working_hours.updated',
          targetType: 'Professional',
          targetId: professionalId,
          metadata: { weekdays: days.map((d) => d.weekday) },
        },
        tx,
      )
    })
  }
  return loadWeek(ctx, professionalId)
}
