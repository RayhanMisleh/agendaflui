import { flushUsage } from '@/server/api/usage'
import { purgeRefreshTokens } from '@/server/auth/api-tokens'
import { purgeRateLimits } from '@/server/auth/rate-limit-db'
import { purgeVerificationCodes } from '@/server/auth/verification-code'
import { processDueNotifications } from './worker'

const GUARD = '__agendafluiScheduler'
const ROUND_MS = 60_000
const CLEANUP_MS = 60 * 60_000
const FIRST_ROUND_MS = 2_000
const USAGE_FLUSH_MS = 30_000
const SHUTDOWN_FLUSH_MS = 3_000

type Deps = {
  run?: () => Promise<unknown>
  cleanup?: () => Promise<unknown>
  /** Grava as métricas de uso da API (padrão: `flushUsage`). */
  flush?: () => Promise<unknown>
}

/** Limpeza periódica (idempotente: várias instâncias podem rodá-la ao mesmo tempo sem problema). */
async function defaultCleanup(): Promise<void> {
  const now = new Date()
  await purgeRateLimits(now)
  await purgeVerificationCodes(now)
  await purgeRefreshTokens(now)
}

/** Registra só o nome do erro: a mensagem pode ter e-mail, token ou dado de conta. */
function report(what: string, err: unknown): void {
  console.error(`[avisos] erro em ${what}: ${err instanceof Error ? err.name : 'desconhecido'}`)
}

/**
 * Agendador dos avisos: uma rodada por minuto e a limpeza de hora em hora, nunca duas rodadas ao mesmo tempo (se a anterior
 * ainda roda, pula). Os temporizadores não seguram o processo. Erro numa rodada é registrado e a seguinte roda normalmente.
 */
export function startScheduler(deps: Deps = {}): { stop: () => void; shutdown: () => Promise<void> } {
  // Um agendador por processo, mesmo que `register()` rode mais de uma vez.
  const existing = Reflect.get(globalThis, GUARD) as { stop: () => void; shutdown: () => Promise<void> } | undefined
  if (existing) return existing
  const run = deps.run ?? (() => processDueNotifications())
  const cleanup = deps.cleanup ?? defaultCleanup
  const flush = deps.flush ?? flushUsage
  let flushing = false
  let busy = false
  let cleaning = false
  let lastCleanup = Number.NEGATIVE_INFINITY

  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      await run()
    } catch (err) {
      report('rodada de envio', err)
    } finally {
      busy = false
    }
    const t = Date.now()
    if (cleaning || t - lastCleanup < CLEANUP_MS) return
    cleaning = true
    lastCleanup = t
    try {
      await cleanup()
    } catch (err) {
      report('limpeza', err)
    } finally {
      cleaning = false
    }
  }

  const flushTick = async (): Promise<void> => {
    if (flushing) return
    flushing = true
    try {
      await flush()
    } catch (err) {
      report('métricas de uso', err)
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

  const first = setTimeout(() => void tick(), FIRST_ROUND_MS)
  const every = setInterval(() => void tick(), ROUND_MS)
  const usage = setInterval(() => void flushTick(), USAGE_FLUSH_MS)
  first.unref()
  every.unref()
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
