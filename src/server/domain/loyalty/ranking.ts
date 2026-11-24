import type { TenantContext } from '@/server/auth/actor'
import { requireModule } from '@/server/domain/modules'
import { publicUploadUrl, uploadUrl } from '@/server/storage/images'
import { localMonthRange, todayIn } from '@/server/time'

const TOP = 10

export type RankingView = {
  enabled: boolean
  /** Mês local da conta (`AAAA-MM`). */
  month: string
  /** `isYou` só aparece (verdadeiro) na linha do próprio cliente que pediu; a equipe e os outros nunca o recebem. */
  entries: { position: number; firstName: string; avatarUrl: string | null; points: number; isYou?: true }[]
}

/**
 * Ranking do mês: pontos GANHOS (créditos e estornos de atendimento; resgates e ajustes não contam) no mês local corrente
 * da conta, os 10 primeiros com mais de zero ponto, sem clientes arquivados nem anonimizados. Só o primeiro nome e a foto.
 * Desligado nas configurações da Fidelidade: `enabled: false` e lista vazia.
 */
export async function getRanking(ctx: TenantContext): Promise<RankingView> {
  await requireModule(ctx, 'loyalty')
  const today = todayIn(ctx.timeZone, ctx.clock())
  const month = today.slice(0, 7)
  const settings = await ctx.db.businessSettings.findUnique({ where: { businessId: ctx.businessId }, select: { loyaltyRankingEnabled: true } })
  if (settings?.loyaltyRankingEnabled !== true) return { enabled: false, month, entries: [] }

  const range = localMonthRange(today, ctx.timeZone)
  const grouped = await ctx.db.loyaltyTransaction.groupBy({
    by: ['customerId'],
    where: {
      kind: { in: ['EARN', 'EARN_REVERSAL'] },
      createdAt: { gte: range.start, lt: range.end },
      customer: { archivedAt: null, anonymizedAt: null },
    },
    _sum: { points: true },
    having: { points: { _sum: { gt: 0 } } },
    orderBy: [{ _sum: { points: 'desc' } }, { customerId: 'asc' }],
    take: TOP,
  })
  const customers = await ctx.db.customer.findMany({
    where: { id: { in: grouped.map((g) => g.customerId) } },
    include: { avatar: true },
  })
  const byId = new Map(customers.map((c) => [c.id, c]))
  const entries = grouped.flatMap((g, index) => {
    const customer = byId.get(g.customerId)
    if (!customer) return []
    return [
      {
        position: index + 1,
        firstName: customer.name.trim().split(/\s+/)[0] ?? customer.name,
        avatarUrl: ctx.channel === 'app' ? publicUploadUrl(customer.avatar) : uploadUrl(customer.avatar),
        points: g._sum.points ?? 0,
        ...(ctx.actor.kind === 'customer' && ctx.actor.customerId === g.customerId ? { isYou: true as const } : {}),
      },
    ]
  })
  return { enabled: true, month, entries }
}
