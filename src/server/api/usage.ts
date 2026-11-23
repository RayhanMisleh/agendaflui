import 'server-only'
import { writeUsageRows, type UsageRow } from '@/server/domain/platform/api-usage'
import { startOfUtcHour } from '@/server/time'

export { usageSummary } from '@/server/domain/platform/api-usage'

/** Teto de combinações (conta, rota, hora) distintas por lote: acima disso, as novas são descartadas até o próximo envio. */
export const MAX_PENDING_USAGE = 5000

type UsageState = { pending: Map<string, UsageRow>; capWarned: boolean }

/*
 * O Next compila as rotas e a instrumentação (que roda o agendador) em camadas separadas: cada uma teria a sua cópia
 * deste módulo e o agendador esvaziaria um acumulador sempre vazio. Por isso o estado fica em `globalThis`, como o
 * cliente Prisma em `db/client.ts`.
 */
const STATE_KEY = Symbol.for('agendaflui.apiUsage')

function state(): UsageState {
  const g = globalThis as unknown as Record<symbol, UsageState | undefined>
  return (g[STATE_KEY] ??= { pending: new Map(), capWarned: false })
}

/** Registra só o nome do erro: a mensagem pode ter dado de conta. */
function logFailure(event: string, err: unknown): void {
  console.error(JSON.stringify({ level: 'error', event, error: err instanceof Error ? err.name : 'unknown' }))
}

/**
 * Soma o uso de uma requisição na memória. Nunca lança nem toca o banco: o `flushUsage` grava depois.
 * A linha é por (conta, rota, hora).
 */
export function recordUsage(e: { businessId: string; route: string; ms: number; error: boolean; at: Date }): void {
  try {
    const st = state()
    const hour = startOfUtcHour(e.at)
    const k = `${e.businessId}|${hour.getTime()}|${e.route}`
    const ms = Number.isFinite(e.ms) ? Math.max(0, Math.round(e.ms)) : 0
    const atual = st.pending.get(k)
    if (atual === undefined) {
      if (st.pending.size >= MAX_PENDING_USAGE) {
        if (!st.capWarned) {
          st.capWarned = true
          console.warn(JSON.stringify({ level: 'warn', event: 'usage_buffer_full', max: MAX_PENDING_USAGE }))
        }
        return
      }
      st.pending.set(k, { businessId: e.businessId, route: e.route, hour, count: 1, errorCount: e.error ? 1 : 0, totalMs: ms, maxMs: ms })
      return
    }
    atual.count += 1
    if (e.error) atual.errorCount += 1
    atual.totalMs += ms
    if (ms > atual.maxMs) atual.maxMs = ms
  } catch {
    // Métrica nunca derruba a requisição.
  }
}

/**
 * Troca o acumulador por um vazio e grava o que havia. Se a gravação falhar, o lote se perde (sem reenfileirar) e o erro sobe
 * para quem chamou. Devolve quantas linhas gravou. O agendador usa esta forma para registrar a falha.
 */
export async function flushUsageOrThrow(): Promise<number> {
  const st = state()
  if (st.pending.size === 0) return 0
  const lote = [...st.pending.values()]
  st.pending = new Map()
  st.capWarned = false
  await writeUsageRows(lote)
  return lote.length
}

/** Como `flushUsageOrThrow`, mas a falha não sobe: só o nome do erro é registrado e devolve 0. */
export async function flushUsage(): Promise<number> {
  try {
    return await flushUsageOrThrow()
  } catch (err) {
    logFailure('usage_flush_failed', err)
    return 0
  }
}
