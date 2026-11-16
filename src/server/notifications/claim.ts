import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { addMinutes, toIsoInstant } from '@/server/time'

/** Quanto tempo uma rodada fica dona das linhas que reservou. */
export const CLAIM_MINUTES = 2

export type Claimed = { id: string; businessId: string; lockedBy: string }

/**
 * Reserva até `limit` avisos pendentes e vencidos (em ordem de `scheduled_for`) numa única instrução: `FOR UPDATE SKIP LOCKED`
 * faz duas rodadas simultâneas receberem linhas diferentes. A reserva dura `CLAIM_MINUTES`; `locked_by` identifica esta
 * chamada, e a atualização final de cada linha só vale se ainda for dela.
 */
export async function claimDue(now: Date, limit: number): Promise<Claimed[]> {
  const lockedBy = randomUUID()
  const nowIso = toIsoInstant(now)
  const untilIso = toIsoInstant(addMinutes(now, CLAIM_MINUTES))
  const rows = await prisma.$queryRaw<{ id: string; businessId: string; scheduledFor: Date }[]>`
    WITH due AS (
      SELECT id FROM notifications
      WHERE status = 'PENDING'
        AND scheduled_for <= ${nowIso}::timestamptz
        AND (locked_until IS NULL OR locked_until <= ${nowIso}::timestamptz)
      ORDER BY scheduled_for, id
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notifications n
    SET locked_until = ${untilIso}::timestamptz, locked_by = ${lockedBy}, updated_at = ${nowIso}::timestamptz
    FROM due
    WHERE n.id = due.id
    RETURNING n.id, n.business_id AS "businessId", n.scheduled_for AS "scheduledFor"
  `
  return rows
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, businessId: r.businessId, lockedBy }))
}
