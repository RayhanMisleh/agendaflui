import type { TenantContext } from '@/server/auth/actor'
import type { Prisma } from '@/server/db/generated/client'
import { authorize } from '@/server/domain/errors'
import { getDaySummary, type DaySummary } from '@/server/domain/scheduling/agenda'
import { staffScope, toView, actorKind, type AppointmentView, type Row } from '@/server/domain/scheduling/appointment-view'
import { OPEN_STATUSES } from '@/server/domain/scheduling/status'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { localDayRange, localMonthRange, todayLine, weekdayOf, type Weekday } from '@/server/time'

export type HomeOverview = {
  /** Hoje no fuso da conta (`AAAA-MM-DD`), o rótulo para a tela (`17/11/2026`) e o dia da semana. */
  date: string
  dateLabel: string
  weekday: Weekday
  /** `all`: dono, gerente e suporte veem todas as agendas; `own`: o profissional vê só a dele. */
  scope: 'all' | 'own'
  /** Ocupação e totais de hoje (o mesmo resumo da agenda). */
  summary: DaySummary
  /** O próximo atendimento aberto que ainda não terminou: em andamento, mais tarde hoje ou, se hoje acabou, nos dias seguintes. */
  next: AppointmentView | null
  /** O resto de hoje depois do próximo, em ordem de horário. */
  later: AppointmentView[]
  /** Atendimentos de hoje e do mês (do dia 1 ao último dia, no fuso da conta) que não foram cancelados. */
  counts: { today: number; month: number }
}

const include = { items: true, customer: true, professional: true } satisfies Prisma.AppointmentInclude
/** Teto da lista de hoje, contando o próximo. */
const TODAY_LIMIT = 8

/**
 * Dados do Início do painel: próximos atendimentos de hoje, ocupação do dia e contadores. Dono, gerente e suporte veem
 * todas as agendas; o profissional, só a dele (e sem ficha ligada ao acesso, nada).
 */
export async function getHomeOverview(ctx: TenantContext): Promise<HomeOverview> {
  authorize(ctx, 'view_dashboard')
  const scope = await staffScope(ctx, actorKind(ctx))
  const now = ctx.clock()
  const { iso: date, label: dateLabel } = todayLine(now, ctx.timeZone)
  const summary = await getDaySummary(ctx, date)
  const base = { date, dateLabel, weekday: weekdayOf(date), scope: scope.all ? ('all' as const) : ('own' as const), summary }
  if (!scope.all && scope.ownId === null) return { ...base, next: null, later: [], counts: { today: 0, month: 0 } }

  const mine: Prisma.AppointmentWhereInput = scope.all ? {} : { professionalId: scope.ownId ?? '' }
  const day = localDayRange(date, ctx.timeZone)
  const month = localMonthRange(date, ctx.timeZone)
  const open = { status: { in: [...OPEN_STATUSES] }, endsAt: { gt: now } }
  const notCanceled = { status: { not: 'CANCELED' as const } }

  const changeWindowMin = (await getSchedulingRules(ctx)).customerChangeWindowMin
  const next: Row | null = await ctx.db.appointment.findFirst({
    where: { ...mine, ...open },
    include,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  const todayRows: Row[] = await ctx.db.appointment.findMany({
    where: { ...mine, ...open, startsAt: { gte: day.start, lt: day.end } },
    include,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: TODAY_LIMIT,
  })
  const today = await ctx.db.appointment.count({ where: { ...mine, ...notCanceled, startsAt: { gte: day.start, lt: day.end } } })
  const inMonth = await ctx.db.appointment.count({ where: { ...mine, ...notCanceled, startsAt: { gte: month.start, lt: month.end } } })

  return {
    ...base,
    next: next ? toView(ctx, next, scope, changeWindowMin) : null,
    later: todayRows.filter((r) => r.id !== next?.id).map((r) => toView(ctx, r, scope, changeWindowMin)),
    counts: { today, month: inMonth },
  }
}
