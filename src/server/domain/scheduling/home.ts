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
  /** Profissional cujo acesso ainda não está ligado a uma ficha de profissional: não há agenda para mostrar. */
  unlinked: boolean
  /** Ocupação e totais de hoje (o mesmo resumo da agenda). */
  summary: DaySummary
  /** O próximo atendimento aberto que ainda não terminou: em andamento, mais tarde hoje ou, se hoje acabou, nos dias seguintes. */
  next: AppointmentView | null
  /** O resto de hoje depois do próximo, em ordem de horário. */
  later: AppointmentView[]
  /** Atendimentos de hoje e do mês (do dia 1 ao último dia, no fuso da conta) que não foram cancelados. */
  counts: { today: number; month: number }
}

const include = { items: true, customer: true, professional: true, pet: true } satisfies Prisma.AppointmentInclude
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
  const weekday = weekdayOf(date)
  const unlinked = !scope.all && scope.ownId === null
  const head = { date, dateLabel, weekday, scope: scope.all ? ('all' as const) : ('own' as const), unlinked }
  if (unlinked) return { ...head, summary: await getDaySummary(ctx, date), next: null, later: [], counts: { today: 0, month: 0 } }

  const mine: Prisma.AppointmentWhereInput = scope.all ? {} : { professionalId: scope.ownId ?? '' }
  const day = localDayRange(date, ctx.timeZone)
  const month = localMonthRange(date, ctx.timeZone)
  const open = { status: { in: [...OPEN_STATUSES] }, endsAt: { gt: now } }
  const notCanceled = { status: { not: 'CANCELED' as const } }

  const [summary, next, todayRows, today, inMonth] = await Promise.all([
    getDaySummary(ctx, date),
    ctx.db.appointment.findFirst({ where: { ...mine, ...open }, include, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] }),
    ctx.db.appointment.findMany({
      where: { ...mine, ...open, startsAt: { gte: day.start, lt: day.end } },
      include,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: TODAY_LIMIT,
    }),
    ctx.db.appointment.count({ where: { ...mine, ...notCanceled, startsAt: { gte: day.start, lt: day.end } } }),
    ctx.db.appointment.count({ where: { ...mine, ...notCanceled, startsAt: { gte: month.start, lt: month.end } } }),
  ])
  // A janela de mudança só serve para montar a visão de um atendimento: sem atendimento, nem lê as regras.
  const changeWindowMin = next || todayRows.length > 0 ? (await getSchedulingRules(ctx)).customerChangeWindowMin : 0
  const view = (r: Row): AppointmentView => toView(ctx, r, scope, changeWindowMin)

  return {
    ...head,
    summary,
    next: next ? view(next) : null,
    later: todayRows.filter((r) => r.id !== next?.id).map(view),
    counts: { today, month: inMonth },
  }
}
