import type { TenantContext } from '@/server/auth/actor'
import {
  appointmentWhere,
  REPORT_STATUSES,
  resolveScope,
  seesCommissionOf,
  type ReportFilter,
} from '@/server/domain/reports/shared'
import { addDays, compareLocalDates, localDayRange } from '@/server/time'

export type { ReportFilter, ReportRange } from '@/server/domain/reports/shared'

export type ReportSummary = {
  revenueCents: number
  completed: number
  canceled: number
  noShow: number
  averageTicketCents: number
  commissionCents: number | null
  byDay: { date: string; revenueCents: number; completed: number }[]
}

/** Consultas de dia em paralelo, para não esgotar o pool de conexões. */
const DAY_BATCH = 8

export async function getReportSummary(ctx: TenantContext, f: ReportFilter): Promise<ReportSummary> {
  const scope = await resolveScope(ctx, f)
  const groups = await ctx.db.appointment.groupBy({
    by: ['status'],
    where: appointmentWhere(scope, REPORT_STATUSES),
    _count: { _all: true },
    _sum: { totalCents: true, commissionCents: true },
  })
  const of = (status: (typeof REPORT_STATUSES)[number]) => groups.find((g) => g.status === status)
  const done = of('COMPLETED')
  const completed = done?._count._all ?? 0
  const revenueCents = done?._sum.totalCents ?? 0

  // Um agregado por dia local: o banco não conhece o fuso da conta, e o dia local tem limites próprios (horário de verão).
  const dates: string[] = []
  for (let date = scope.from; compareLocalDates(date, scope.to) <= 0; date = addDays(date, 1)) dates.push(date)
  const byDay: ReportSummary['byDay'] = []
  for (let i = 0; i < dates.length; i += DAY_BATCH) {
    const batch = dates.slice(i, i + DAY_BATCH)
    const days = await Promise.all(
      batch.map(async (date) => {
        const sum = await ctx.db.appointment.aggregate({
          where: appointmentWhere(scope, ['COMPLETED'], localDayRange(date, ctx.timeZone)),
          _count: { _all: true },
          _sum: { totalCents: true },
        })
        return { date, revenueCents: sum._sum.totalCents ?? 0, completed: sum._count._all }
      }),
    )
    byDay.push(...days)
  }

  return {
    revenueCents,
    completed,
    canceled: of('CANCELED')?._count._all ?? 0,
    noShow: of('NO_SHOW')?._count._all ?? 0,
    averageTicketCents: completed === 0 ? 0 : Math.round(revenueCents / completed),
    commissionCents: seesCommissionOf(scope, scope.professionalId ?? '') ? (done?._sum.commissionCents ?? 0) : null,
    byDay,
  }
}
