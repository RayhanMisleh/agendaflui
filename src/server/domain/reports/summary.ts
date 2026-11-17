import type { TenantContext } from '@/server/auth/actor'
import {
  appointmentWhere,
  serviceItemWhere,
  REPORT_STATUSES,
  resolveScope,
  seesCommissionOf,
  type ReportFilter,
} from '@/server/domain/reports/shared'
import { addDays, compareLocalDates, localDayRange } from '@/server/time'

export type { ReportFilter, ReportRange } from '@/server/domain/reports/shared'

/**
 * Com `serviceId` no filtro, `revenueCents` (total e de cada dia) é a soma dos itens daquele serviço nos concluídos, o
 * ticket médio é essa receita por atendimento concluído e `commissionCents` é `null`: a comissão é gravada por atendimento,
 * não por serviço (a tela mostra "—").
 */
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
  const revenueCents = scope.serviceId
    ? ((
        await ctx.db.appointmentItem.aggregate({
          where: serviceItemWhere(scope, scope.serviceId),
          _sum: { priceCents: true },
        })
      )._sum.priceCents ?? 0)
    : (done?._sum.totalCents ?? 0)

  // Um agregado por dia local: o banco não conhece o fuso da conta, e o dia local tem limites próprios (horário de verão).
  const dates: string[] = []
  for (let date = scope.from; compareLocalDates(date, scope.to) <= 0; date = addDays(date, 1)) dates.push(date)
  const byDay: ReportSummary['byDay'] = []
  for (let i = 0; i < dates.length; i += DAY_BATCH) {
    const batch = dates.slice(i, i + DAY_BATCH)
    const days = await Promise.all(
      batch.map(async (date) => {
        const range = localDayRange(date, ctx.timeZone)
        const sum = await ctx.db.appointment.aggregate({
          where: appointmentWhere(scope, ['COMPLETED'], range),
          _count: { _all: true },
          _sum: { totalCents: true },
        })
        const items = scope.serviceId
          ? await ctx.db.appointmentItem.aggregate({
              where: serviceItemWhere(scope, scope.serviceId, { range }),
              _sum: { priceCents: true },
            })
          : null
        const revenue = items ? items._sum.priceCents : sum._sum.totalCents
        return { date, revenueCents: revenue ?? 0, completed: sum._count._all }
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
    commissionCents: !scope.serviceId && (scope.professionalId === undefined ? scope.seesAllCommission : seesCommissionOf(scope, scope.professionalId)) ? (done?._sum.commissionCents ?? 0) : null,
    byDay,
  }
}
