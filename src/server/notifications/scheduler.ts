import { runRetention } from '@/server/db/retention'
import { purgeRateLimits } from '@/server/auth/rate-limit-db'
import { purgeExpiredSessions, purgeSupportHandoffs } from '@/server/auth/support-session'
import { purgeEmailCodes } from '@/server/auth/email-code'
import { failureSummary, purgeSchedulerRuns, recordSchedulerRun, summarize, type RunRecorder, type SchedulerKind } from './scheduler-runs'
import { sweepStore } from '@/server/domain/platform/store-sweep'
import { processCalendarSyncs } from '@/server/calendar/worker'
import { processDueNotifications } from './worker'

const GUARD = '__agendafluiScheduler'
const ROUND_MS = 60_000
const CLEANUP_MS = 60 * 60_000
const FIRST_ROUND_MS = 2_000
const RETENTION_MS = 24 * 60 * 60_000

type Deps = {
  run?: () => Promise<unknown>
  /** Varredura da loja a cada rodada (padrão: `sweepStore`; quem troca `run` e não passa `sweep` fica sem varredura). */
  sweep?: () => Promise<unknown>
  /** Envio ao Google Agenda a cada rodada (padrão: `processCalendarSyncs`; quem troca `run` e não passa `calendar` fica sem ele). */
  calendar?: () => Promise<unknown>
  cleanup?: () => Promise<unknown>
  /** Limpeza diária de dados antigos (padrão: `runRetention`; quem troca `run` e não passa `retention` fica sem ela). */
  retention?: () => Promise<unknown>
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
    codigos: await purgeEmailCodes(now),
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
 * ainda roda, pula). Os temporizadores não seguram o processo. Erro numa rodada é registrado e a seguinte roda normalmente.
 */
export function startScheduler(deps: Deps = {}): { stop: () => void } {
  // Um agendador por processo, mesmo que `register()` rode mais de uma vez.
  const existing = Reflect.get(globalThis, GUARD) as { stop: () => void } | undefined
  if (existing) return existing
  const run = deps.run ?? (() => processDueNotifications())
  const sweep = deps.sweep ?? (deps.run === undefined ? () => sweepStore(new Date()) : null)
  const calendar = deps.calendar ?? (deps.run === undefined ? () => processCalendarSyncs() : null)
  const retention = deps.retention ?? (deps.run === undefined ? () => runRetention(new Date()) : null)
  const cleanup = deps.cleanup ?? (() => cleanupRound())
  const record = deps.record ?? recordSchedulerRun
  let busy = false
  let cleaning = false
  let retaining = false
  let lastCleanup = Number.NEGATIVE_INFINITY
  let lastRetention = Number.NEGATIVE_INFINITY

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
      // Só grava execução quando a agenda gravou, apagou, desligou, adiou ou desistiu de algo (ou falhou).
      if (calendar !== null) {
        await timed('calendar', 'agenda do Google', calendar, (r) => {
          const n = r as Record<string, unknown>
          return ['upserted', 'deleted', 'revoked', 'retried', 'failed'].some((k) => typeof n[k] === 'number' && n[k] > 0)
        })
      }
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
    if (!cleaning && t - lastCleanup >= CLEANUP_MS) {
      cleaning = true
      lastCleanup = t
      try {
        await timed('cleanup', 'limpeza', cleanup)
      } finally {
        cleaning = false
      }
    }
    // Uma vez por dia (e na primeira rodada depois de subir): dados antigos saem em lotes pequenos.
    if (retention !== null && !retaining && t - lastRetention >= RETENTION_MS) {
      retaining = true
      lastRetention = t
      try {
        await timed('retention', 'retenção de dados', retention)
      } finally {
        retaining = false
      }
    }
  }

  const first = setTimeout(() => void tick(), FIRST_ROUND_MS)
  const every = setInterval(() => void tick(), ROUND_MS)
  first.unref()
  every.unref()
  const handle = {
    stop() {
      clearTimeout(first)
      clearInterval(every)
      Reflect.deleteProperty(globalThis, GUARD)
    },
  }
  Reflect.set(globalThis, GUARD, handle)
  return handle
}
