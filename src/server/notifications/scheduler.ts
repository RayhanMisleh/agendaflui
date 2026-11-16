import { purgeRefreshTokens } from '@/server/auth/api-tokens'
import { purgeRateLimits } from '@/server/auth/rate-limit-db'
import { purgeVerificationCodes } from '@/server/auth/verification-code'
import { processDueNotifications } from './worker'

const ROUND_MS = 60_000
const CLEANUP_MS = 60 * 60_000
const FIRST_ROUND_MS = 2_000

type Deps = {
  run?: () => Promise<unknown>
  cleanup?: () => Promise<unknown>
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
export function startScheduler(deps: Deps = {}): { stop: () => void } {
  const run = deps.run ?? (() => processDueNotifications())
  const cleanup = deps.cleanup ?? defaultCleanup
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

  const first = setTimeout(() => void tick(), FIRST_ROUND_MS)
  const every = setInterval(() => void tick(), ROUND_MS)
  first.unref()
  every.unref()
  return {
    stop() {
      clearTimeout(first)
      clearInterval(every)
    },
  }
}
