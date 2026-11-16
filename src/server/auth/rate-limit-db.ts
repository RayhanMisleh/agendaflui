import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { toIsoInstant } from '@/server/time'

export type LimitRule = { limit: number; windowSec: number }

export const LIMITS = {
  loginEmail: { limit: 5, windowSec: 900 },
  loginIp: { limit: 20, windowSec: 900 },
  apiKeyIp: { limit: 120, windowSec: 60 },
  authIp: { limit: 10, windowSec: 900 },
  booking: { limit: 20, windowSec: 60 },
} as const satisfies Record<string, LimitRule>

const MAX_KEY = 200

/**
 * Chave de limite estável e legível: `<prefixo>:<valor>`, por exemplo `login:painel:email:a@b.com`.
 * Passando de 200 caracteres, o valor vira `h:<sha256 em hex>`.
 */
export function limitKey(prefix: string, value: string): string {
  const direta = `${prefix}:${value}`
  if (direta.length <= MAX_KEY) return direta
  return `${prefix}:h:${createHash('sha256').update(value).digest('hex')}`
}

/**
 * Conta uma tentativa na janela fixa da chave, numa única instrução atômica: zera quando a janela
 * venceu, incrementa senão. A contagem para em `limit + 1`. O estado fica no banco, então vale
 * entre processos e reinícios.
 */
export async function hitRateLimit(
  key: string,
  rule: LimitRule,
  now: Date,
): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
  if (key.length === 0 || key.length > MAX_KEY) {
    throw new Error(`Chave de limite inválida: precisa ter de 1 a ${MAX_KEY} caracteres.`)
  }
  // O instante vai como texto ISO com Z: o banco não o reinterpreta no fuso da sessão.
  const agora = toIsoInstant(now)
  const rows = await prisma.$queryRaw<{ count: number; window_start: Date }[]>`
    INSERT INTO rate_limit_buckets AS b ("key", "window_start", "count")
    VALUES (${key}, ${agora}::timestamptz, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "window_start" = CASE
        WHEN b."window_start" <= ${agora}::timestamptz - make_interval(secs => ${rule.windowSec}::double precision)
        THEN ${agora}::timestamptz ELSE b."window_start" END,
      "count" = CASE
        WHEN b."window_start" <= ${agora}::timestamptz - make_interval(secs => ${rule.windowSec}::double precision)
        THEN 1 ELSE LEAST(b."count" + 1, ${rule.limit}::int + 1) END
    RETURNING "count", "window_start"`
  const row = rows[0]
  if (!row) throw new Error('O limite de requisições não devolveu a contagem.')
  const allowed = row.count <= rule.limit
  const fimDaJanela = row.window_start.getTime() + rule.windowSec * 1000
  return {
    allowed,
    remaining: Math.max(0, rule.limit - row.count),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((fimDaJanela - now.getTime()) / 1000)),
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({ where: { key } })
}

/** Apaga as janelas que começaram antes de `olderThan`; devolve quantas. */
export async function purgeRateLimits(olderThan: Date): Promise<number> {
  const r = await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: olderThan } } })
  return r.count
}
