import { prisma } from '@/server/db/client'
import { fromEpochMs } from '@/server/time'

export const SCHEDULER_KINDS = ['notifications', 'cleanup', 'usage_flush', 'store'] as const
export type SchedulerKind = (typeof SCHEDULER_KINDS)[number]

export type RunRecord = { kind: SchedulerKind; startedAt: Date; finishedAt: Date; ok: boolean; summary: string }
export type RunRecorder = (run: RunRecord) => Promise<void>

/** Execuções com mais de 14 dias saem na limpeza horária. */
export const RUN_RETENTION_DAYS = 14

/** Rótulos das contagens que podem entrar no resumo. O que não está aqui nunca é gravado (e-mail, nome, token). */
const LABELS: Readonly<Record<string, string>> = {
  sent: 'enviados',
  skipped: 'ignorados',
  failed: 'falhas',
  synced: 'pagamentos conferidos',
  expired: 'pedidos vencidos',
  retried: 'novas tentativas',
  limites: 'limites',
  codigos: 'códigos',
  tokens: 'tokens',
  execucoes: 'execuções',
  passagens: 'passagens',
  sessoes: 'sessões',
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

/** Resumo curto de um resultado: só as contagens conhecidas ("enviados 3, falhas 1"). Número solto vira "linhas N". */
export function summarize(result: unknown): string {
  if (isCount(result)) return `linhas ${result}`
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return ''
  const partes: string[] = []
  for (const [chave, valor] of Object.entries(result)) {
    const rotulo = LABELS[chave]
    if (rotulo !== undefined && isCount(valor)) partes.push(`${rotulo} ${valor}`)
  }
  return partes.join(', ')
}

/** Só o nome do erro: a mensagem pode ter e-mail, token ou dado de conta. */
export function failureSummary(err: unknown): string {
  const nome = err instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(err.name) ? err.name : 'desconhecido'
  return `erro: ${nome}`
}

/** Grava uma execução do agendador. */
export async function recordSchedulerRun(run: RunRecord): Promise<void> {
  await prisma.schedulerRun.create({
    data: { kind: run.kind, startedAt: run.startedAt, finishedAt: run.finishedAt, ok: run.ok, summary: run.summary.slice(0, 200) },
  })
}

/** Apaga as execuções com mais de 14 dias. Devolve quantas apagou. */
export async function purgeSchedulerRuns(now: Date): Promise<number> {
  const corte = fromEpochMs(now.getTime() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const r = await prisma.schedulerRun.deleteMany({ where: { startedAt: { lt: corte } } })
  return r.count
}
