import { Prisma } from '@/server/db/generated/client'
import { fromEpochMs } from '@/server/time'
import { prisma } from './client'

/** Prazos de guarda, em dias: o que for mais velho que isto sai na limpeza diária (`runRetention`). */
export const RETENTION_DAYS = { notifications: 90, audit: 730 } as const

/** Linhas por comando DELETE: lotes pequenos para a limpeza nunca segurar a tabela por muito tempo. */
export const RETENTION_BATCH_SIZE = 1000
/** Teto de lotes por tabela numa rodada; o que sobrar sai na rodada do dia seguinte. */
export const RETENTION_MAX_BATCHES = 200

const DAY_MS = 24 * 60 * 60 * 1000

export type RetentionResult = { avisos: number; auditoria: number }
type Options = { batchSize?: number; maxBatches?: number }

/** Apaga em lotes até não achar mais nada (ou bater o teto de lotes). `delete` recebe o limite e devolve quantas apagou. */
async function inBatches(delete_: (limit: number) => Promise<number>, { batchSize, maxBatches }: Required<Options>): Promise<number> {
  let total = 0
  for (let i = 0; i < maxBatches; i += 1) {
    const n = await delete_(batchSize)
    total += n
    if (n < batchSize) break
  }
  return total
}

/**
 * Limpeza diária de dados antigos: avisos já terminados (enviados, descartados ou com falha definitiva) com mais de 90 dias, e auditoria com mais de 2 anos. Idempotente: várias instâncias podem rodá-la juntas.
 * Devolve só contagens.
 */
export async function runRetention(now: Date, options: Options = {}): Promise<RetentionResult> {
  const opts = { batchSize: options.batchSize ?? RETENTION_BATCH_SIZE, maxBatches: options.maxBatches ?? RETENTION_MAX_BATCHES }
  const corte = (dias: number) => fromEpochMs(now.getTime() - dias * DAY_MS)
  const avisos = corte(RETENTION_DAYS.notifications)
  const auditoria = corte(RETENTION_DAYS.audit)
  return {
    avisos: await inBatches(
      (limit) =>
        prisma.$executeRaw(Prisma.sql`
          DELETE FROM notifications WHERE id IN (
            SELECT id FROM notifications
            WHERE status IN ('SENT', 'FAILED', 'SKIPPED', 'CANCELED') AND updated_at < ${avisos}
            LIMIT ${limit})`),
      opts,
    ),
    auditoria: await inBatches(
      (limit) =>
        prisma.$executeRaw(Prisma.sql`
          DELETE FROM audit_logs WHERE id IN (
            SELECT id FROM audit_logs WHERE created_at < ${auditoria} LIMIT ${limit})`),
      opts,
    ),
  }
}
