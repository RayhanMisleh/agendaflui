import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { addMinutes, startOfUtcHour } from '@/server/time'
import { DomainError, parse, z } from '../errors'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

/** Uma linha de uso já somada: chave, rota e hora cheia (UTC). `businessId` é `null` quando a linha mistura contas. */
export type UsageRow = {
  apiKeyId: string
  businessId: string | null
  route: string
  hour: Date
  count: number
  errorCount: number
  totalMs: number
  maxMs: number
}

const MAX_RANGE_DAYS = 92

/**
 * Grava as linhas por upsert incremental: soma contagens e tempos, sobe o máximo e, se a linha já existe com outra conta
 * (chave de plataforma atendendo contas diferentes na mesma hora), deixa a conta em branco. Tudo numa transação.
 */
export async function writeUsageRows(rows: UsageRow[]): Promise<void> {
  if (rows.length === 0) return
  await prisma.$transaction(
    rows.map(
      (r) => prisma.$executeRaw`
        INSERT INTO api_usage_hourly (api_key_id, business_id, route, hour, count, error_count, total_ms, max_ms, updated_at)
        VALUES (${r.apiKeyId}::uuid, ${r.businessId}::uuid, ${r.route}, ${r.hour}::timestamptz, ${r.count}::int, ${r.errorCount}::int,
                ${r.totalMs}::bigint, ${r.maxMs}::int, now())
        ON CONFLICT (api_key_id, route, hour) DO UPDATE SET
          count = api_usage_hourly.count + excluded.count,
          error_count = api_usage_hourly.error_count + excluded.error_count,
          total_ms = api_usage_hourly.total_ms + excluded.total_ms,
          max_ms = GREATEST(api_usage_hourly.max_ms, excluded.max_ms),
          business_id = CASE WHEN api_usage_hourly.business_id IS NOT DISTINCT FROM excluded.business_id
                             THEN api_usage_hourly.business_id ELSE NULL END,
          updated_at = now()`,
    ),
  )
}

const resumoSchema = z.object({
  from: z.date(),
  to: z.date(),
  apiKeyId: z.uuid().optional(),
  businessId: z.uuid().optional(),
})

/** Uso da API por rota no intervalo (horas cheias de `from` até antes de `to`), no máximo 92 dias. Só admin da plataforma. */
export async function usageSummary(
  actor: PlatformAdminActor,
  q: { from: Date; to: Date; apiKeyId?: string; businessId?: string },
): Promise<{ route: string; count: number; errorCount: number; avgMs: number; maxMs: number }[]> {
  if (actor.kind !== 'platform_admin') throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
  const i = parse(resumoSchema, q)
  if (!Number.isFinite(i.from.getTime()) || !Number.isFinite(i.to.getTime()) || i.to.getTime() <= i.from.getTime()) {
    throw new DomainError('validation', 'O fim do período precisa ser depois do início.', { fields: { to: 'Escolha uma data depois do início.' } })
  }
  if (i.to.getTime() > addMinutes(i.from, MAX_RANGE_DAYS * 24 * 60).getTime()) {
    throw new DomainError('validation', `Escolha um período de até ${MAX_RANGE_DAYS} dias.`, { fields: { to: `O período vai até ${MAX_RANGE_DAYS} dias.` } })
  }
  const grupos = await prisma.apiUsageHourly.groupBy({
    by: ['route'],
    where: {
      hour: { gte: startOfUtcHour(i.from), lt: i.to },
      ...(i.apiKeyId !== undefined ? { apiKeyId: i.apiKeyId } : {}),
      ...(i.businessId !== undefined ? { businessId: i.businessId } : {}),
    },
    _sum: { count: true, errorCount: true, totalMs: true },
    _max: { maxMs: true },
    orderBy: { route: 'asc' },
  })
  return grupos.map((g) => {
    const count = g._sum.count ?? 0
    return {
      route: g.route,
      count,
      errorCount: g._sum.errorCount ?? 0,
      avgMs: count === 0 ? 0 : Math.round(Number(g._sum.totalMs ?? 0n) / count),
      maxMs: g._max.maxMs ?? 0,
    }
  })
}
