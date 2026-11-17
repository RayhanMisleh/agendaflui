import type { TenantContext } from '@/server/auth/actor'
import {
  appointmentWhere,
  resolveScope,
  serviceItemWhere,
  seesCommissionOf,
  type ReportFilter,
} from '@/server/domain/reports/shared'

/** Com `serviceId`, a receita é a dos itens daquele serviço e a comissão vem `null` (ela é gravada por atendimento). */
export async function getReportByProfessional(
  ctx: TenantContext,
  f: ReportFilter,
): Promise<{ professionalId: string; name: string; completed: number; revenueCents: number; commissionCents: number | null }[]> {
  const scope = await resolveScope(ctx, f)
  const groups = await ctx.db.appointment.groupBy({
    by: ['professionalId'],
    where: appointmentWhere(scope, ['COMPLETED']),
    _count: { _all: true },
    _sum: { totalCents: true, commissionCents: true },
  })
  const names = await ctx.db.professional.findMany({
    where: { id: { in: groups.map((g) => g.professionalId) } },
    select: { id: true, name: true },
  })
  const nameOf = new Map(names.map((p) => [p.id, p.name]))
  const serviceId = scope.serviceId
  const itemRevenue = new Map<string, number>()
  if (serviceId) {
    await Promise.all(
      groups.map(async (g) => {
        const sum = await ctx.db.appointmentItem.aggregate({
          where: serviceItemWhere(scope, serviceId, { professionalId: g.professionalId }),
          _sum: { priceCents: true },
        })
        itemRevenue.set(g.professionalId, sum._sum.priceCents ?? 0)
      }),
    )
  }
  return groups
    .map((g) => ({
      professionalId: g.professionalId,
      name: nameOf.get(g.professionalId) ?? '',
      completed: g._count._all,
      revenueCents: serviceId ? (itemRevenue.get(g.professionalId) ?? 0) : (g._sum.totalCents ?? 0),
      commissionCents:
        !serviceId && seesCommissionOf(scope, g.professionalId) ? (g._sum.commissionCents ?? 0) : null,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name) || a.professionalId.localeCompare(b.professionalId))
}

/** Por serviço: a receita é a soma dos itens do serviço nos atendimentos concluídos (um atendimento pode ter vários serviços). */
export async function getReportByService(
  ctx: TenantContext,
  f: ReportFilter,
): Promise<{ serviceId: string; name: string; count: number; revenueCents: number }[]> {
  const scope = await resolveScope(ctx, f)
  const groups = await ctx.db.appointmentItem.groupBy({
    by: ['serviceId'],
    where: {
      ...(scope.serviceId ? { serviceId: scope.serviceId } : {}),
      appointment: { is: appointmentWhere({ ...scope, serviceId: undefined }, ['COMPLETED']) },
    },
    _count: { _all: true },
    _sum: { priceCents: true },
  })
  const names = await ctx.db.service.findMany({
    where: { id: { in: groups.map((g) => g.serviceId) } },
    select: { id: true, name: true },
  })
  const nameOf = new Map(names.map((s) => [s.id, s.name]))
  return groups
    .map((g) => ({
      serviceId: g.serviceId,
      name: nameOf.get(g.serviceId) ?? '',
      count: g._count._all,
      revenueCents: g._sum.priceCents ?? 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name) || a.serviceId.localeCompare(b.serviceId))
}
