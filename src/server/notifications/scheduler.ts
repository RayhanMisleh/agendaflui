import { flushUsageOrThrow } from '@/server/api/usage'
import { purgeRefreshTokens } from '@/server/auth/api-tokens'
import { purgeRateLimits } from '@/server/auth/rate-limit-db'
import { purgeExpiredSessions, purgeSupportHandoffs } from '@/server/auth/support-session'
import { purgeVerificationCodes } from '@/server/auth/verification-code'
import { failureSummary, purgeSchedulerRuns, recordSchedulerRun, summarize, type RunRecorder, type SchedulerKind } from './scheduler-runs'
import { sweepStore } from '@/server/domain/platform/store-sweep'
import { processDueNotifications } from './worker'

const GUARD = '__agendafluiScheduler'
const ROUND_MS = 60_000
const CLEANUP_MS = 60 * 60_000
const FIRST_ROUND_MS = 2_000
const USAGE_FLUSH_MS = 30_000
const SHUTDOWN_FLUSH_MS = 3_000

type Deps = {
  /** Liga o envio de avisos e a limpeza (padrão: sim). Com `false` só as métricas de uso rodam. */
  worker?: boolean
  run?: () => Promise<unknown>
  /** Varredura da loja a cada rodada (padrão: `sweepStore`; quem troca `run` e não passa `sweep` fica sem varredura). */
  sweep?: () => Promise<unknown>
  cleanup?: () => Promise<unknown>
  /** Grava as métricas de uso da API (padrão: `flushUsageOrThrow`, que devolve quantas linhas gravou). */
  flush?: () => Promise<unknown>
  /** Grava cada execução em `scheduler_runs` (padrão: `recordSchedulerRun`). */
  record?: RunRecorder
}

/**
 * Limpeza periódica (idempotente: várias instâncias podem rodá-la ao mesmo tempo sem problema). Devolve só contagens, que
 * viram o resumo da execução.
 */
export async function cleanupRound(now: Date = new Date()): Promise<Record<string, number>> {
  return {
    limites: await purgeRateLimits(now),
    codigos: await purgeVerificationCodes(now),
    tokens: await purgeRefreshTokens(now),
    execucoes: await purgeSchedulerRuns(now),
    passagens: await purgeSupportHandoffs(now),
    sessoes: await purgeExpiredSessions(now),
  }
}

/** Registra só o nome do erro: a mensagem pode ter e-mail, token ou dado de conta. */
function report(what: string, err: unknown): void {
  console.error(`[avisos] erro em ${what}: ${err instanceof Error ? err.name : 'desconhecido'}`)
}

/**
 * Agendador dos avisos: uma rodada por minuto e a limpeza de hora em hora, nunca duas rodadas ao mesmo tempo (se a anterior
 * ainda roda, pula). As métricas de uso sobem a cada 30 s em qualquer caso. Os temporizadores não seguram o processo. Erro numa rodada é registrado e a seguinte roda normalmente.
 */
export function startScheduler(deps: Deps = {}): { stop: () => void; shutdown: () => Promise<void> } {
  // Um agendador por processo, mesmo que `register()` rode mais de uma vez.
  const existing = Reflect.get(globalThis, GUARD) as { stop: () => void; shutdown: () => Promise<void> } | undefined
  if (existing) return existing
  const run = deps.run ?? (() => processDueNotifications())
  const sweep = deps.sweep ?? (deps.run === undefined ? () => sweepStore(new Date()) : null)
  const cleanup = deps.cleanup ?? (() => cleanupRound())
  const flush = deps.flush ?? flushUsageOrThrow
  const record = deps.record ?? recordSchedulerRun
  let flushing = false
  let busy = false
  let cleaning = false
  let lastCleanup = Number.NEGATIVE_INFINITY

  /**
   * Roda uma tarefa e grava a execução (início, fim, `ok` e resumo sem dado pessoal). Erro da tarefa é registrado só pelo nome;
   * falha ao gravar a execução também, e nunca derruba a rodada. `worth` decide se um resultado bem-sucedido merece linha.
   */
  const timed = async (
    kind: SchedulerKind,
    what: string,
    task: () => Promise<unknown>,
    worth: (result: unknown) => boolean = () => true,
  ): Promise<void> => {
    const startedAt = new Date()
    let ok = true
    let summary = ''
    try {
      const result = await task()
      if (!worth(result)) return
      summary = summarize(result)
    } catch (err) {
      report(what, err)
      ok = false
      summary = failureSummary(err)
    }
    // Sem aguardar: um banco lento ou travado nunca segura a rodada nem a limpeza seguinte.
    void Promise.resolve()
      .then(() => record({ kind, startedAt, finishedAt: new Date(), ok, summary }))
      .catch((err: unknown) => report('registro da execução', err))
  }

  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      await timed('notifications', 'rodada de envio', run)
      // Só grava execução quando a varredura conferiu ou venceu algo, ou falhou (1.440 linhas por dia seriam ruído).
      if (sweep !== null) {
        await timed('store', 'varredura da loja', sweep, (r) => {
          const n = r as { synced?: unknown; expired?: unknown }
          return (typeof n.synced === 'number' && n.synced > 0) || (typeof n.expired === 'number' && n.expired > 0)
        })
      }
    } finally {
      busy = false
    }
    const t = Date.now()
    if (cleaning || t - lastCleanup < CLEANUP_MS) return
    cleaning = true
    lastCleanup = t
    try {
      await timed('cleanup', 'limpeza', cleanup)
    } finally {
      cleaning = false
    }
  }

  const flushTick = async (): Promise<void> => {
    if (flushing) return
    flushing = true
    try {
      // 2.880 execuções por dia seriam ruído: só grava quando subiu alguma linha de uso (ou quando falhou).
      await timed('usage_flush', 'métricas de uso', flush, (n) => typeof n === 'number' && n > 0)
    } finally {
      flushing = false
    }
  }

  /** Último envio das métricas ao encerrar, com teto de tempo curto para não segurar o processo. */
  const shutdown = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const teto = new Promise<void>((ok) => {
      timer = setTimeout(ok, SHUTDOWN_FLUSH_MS)
      timer.unref()
    })
    try {
      await Promise.race([flush().then(() => undefined), teto])
    } catch (err) {
      report('métricas de uso', err)
    } finally {
      clearTimeout(timer)
    }
  }

  const worker = deps.worker !== false
  const first = worker ? setTimeout(() => void tick(), FIRST_ROUND_MS) : undefined
  const every = worker ? setInterval(() => void tick(), ROUND_MS) : undefined
  const usage = setInterval(() => void flushTick(), USAGE_FLUSH_MS)
  first?.unref()
  every?.unref()
  usage.unref()
  // Com o processo encerrando por SIGTERM, grava o que falta. Se nenhum outro código cuida do encerramento, sai depois.
  const onSigterm = (): void => {
    void shutdown().finally(() => {
      if (process.listenerCount('SIGTERM') === 0) process.exit(0)
    })
  }
  if (deps.flush === undefined) process.once('SIGTERM', onSigterm)
  const handle = {
    shutdown,
    stop() {
      clearTimeout(first)
      clearInterval(every)
      clearInterval(usage)
      process.removeListener('SIGTERM', onSigterm)
      Reflect.deleteProperty(globalThis, GUARD)
    },
  }
  Reflect.set(globalThis, GUARD, handle)
  return handle
}
