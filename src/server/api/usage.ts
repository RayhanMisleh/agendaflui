import 'server-only'
import { writeUsageRows, type UsageRow } from '@/server/domain/platform/api-usage'
import { startOfUtcHour } from '@/server/time'

export { usageSummary } from '@/server/domain/platform/api-usage'

/** Teto de combinações (chave, rota, hora) distintas por lote: acima disso, as novas são descartadas até o próximo envio. */
export const MAX_PENDING_USAGE = 5000

type Pending = Map<string, UsageRow>

let pending: Pending = new Map()
let capWarned = false

/** Registra só o nome do erro: a mensagem pode ter dado de conta. */
function logFailure(event: string, err: unknown): void {
  console.error(JSON.stringify({ level: 'error', event, error: err instanceof Error ? err.name : 'unknown' }))
}

/**
 * Soma o uso de uma requisição na memória. Nunca lança nem toca o banco: o `flushUsage` grava depois.
 * `businessId` fica `null` quando a mesma linha recebe contas diferentes (chave de plataforma).
 */
export function recordUsage(e: { apiKeyId: string; businessId: string | null; route: string; ms: number; error: boolean; at: Date }): void {
  try {
    const hour = startOfUtcHour(e.at)
    const k = `${e.apiKeyId}|${hour.getTime()}|${e.route}`
    const ms = Number.isFinite(e.ms) ? Math.max(0, Math.round(e.ms)) : 0
    const atual = pending.get(k)
    if (atual === undefined) {
      if (pending.size >= MAX_PENDING_USAGE) {
        if (!capWarned) {
          capWarned = true
          console.warn(JSON.stringify({ level: 'warn', event: 'usage_buffer_full', max: MAX_PENDING_USAGE }))
        }
        return
      }
      pending.set(k, { apiKeyId: e.apiKeyId, businessId: e.businessId, route: e.route, hour, count: 1, errorCount: e.error ? 1 : 0, totalMs: ms, maxMs: ms })
      return
    }
    atual.count += 1
    if (e.error) atual.errorCount += 1
    atual.totalMs += ms
    if (ms > atual.maxMs) atual.maxMs = ms
    if (atual.businessId !== e.businessId) atual.businessId = null
  } catch {
    // Métrica nunca derruba a requisição.
  }
}

/**
 * Troca o acumulador por um vazio e grava o que havia. Se a gravação falhar, o lote se perde (sem reenfileirar) e só o
 * nome do erro é registrado. Devolve quantas linhas gravou.
 */
export async function flushUsage(): Promise<number> {
  if (pending.size === 0) return 0
  const lote = [...pending.values()]
  pending = new Map()
  capWarned = false
  try {
    await writeUsageRows(lote)
    return lote.length
  } catch (err) {
    logFailure('usage_flush_failed', err)
    return 0
  }
}
