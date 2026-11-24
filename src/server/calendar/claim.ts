import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { addMinutes, toIsoInstant } from '@/server/time'

/** Quanto tempo uma rodada fica dona das linhas que reservou. */
export const CALENDAR_CLAIM_MINUTES = 2

export type ClaimedSync = {
  id: string
  businessId: string
  appointmentId: string
  generation: number
  placedUserId: string | null
  attempts: number
  lockedBy: string
}

/**
 * Reserva até `limit` linhas atrasadas (`generation > synced_generation`, sem desistência, espera e reserva vencidas) numa
 * instrução só: `FOR UPDATE SKIP LOCKED` faz duas rodadas simultâneas receberem linhas diferentes. A reserva dura
 * `CALENDAR_CLAIM_MINUTES`; `locked_by` identifica esta chamada e a gravação final de cada linha só vale se ainda for dela.
 */
export async function claimCalendarSyncs(now: Date, limit: number): Promise<ClaimedSync[]> {
  const lockedBy = randomUUID()
  const nowIso = toIsoInstant(now)
  const untilIso = toIsoInstant(addMinutes(now, CALENDAR_CLAIM_MINUTES))
  const rows = await prisma.$queryRaw<
    { id: string; businessId: string; appointmentId: string; generation: number; placedUserId: string | null; attempts: number; due: Date }[]
  >`
    WITH due AS (
      SELECT id FROM calendar_syncs
      WHERE generation > synced_generation
        AND failed_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= ${nowIso}::timestamptz)
        AND (locked_until IS NULL OR locked_until <= ${nowIso}::timestamptz)
      ORDER BY COALESCE(next_attempt_at, updated_at), id
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE calendar_syncs s
    SET locked_until = ${untilIso}::timestamptz, locked_by = ${lockedBy}
    FROM due
    WHERE s.id = due.id
    RETURNING s.id, s.business_id AS "businessId", s.appointment_id AS "appointmentId", s.generation,
      s.placed_user_id AS "placedUserId", s.attempts, COALESCE(s.next_attempt_at, s.updated_at) AS due
  `
  return rows
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      businessId: r.businessId,
      appointmentId: r.appointmentId,
      generation: r.generation,
      placedUserId: r.placedUserId,
      attempts: r.attempts,
      lockedBy,
    }))
}
