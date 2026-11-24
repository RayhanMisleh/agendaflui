import 'server-only'
import { openSecret, sealSecret } from '@/server/auth/secret-box'
import { prisma } from '@/server/db/client'

/*
 * LEITURA e selo do token de renovação do Google Agenda de cada pessoa. É o único arquivo que abre esse segredo: só
 * `src/server/calendar/**` pode importá-lo (o ESLint e `tests/unit/calendar-token-imports.test.ts` conferem). O texto puro
 * nunca sai daqui para tela, log, auditoria ou erro; selo que não abre vira `unreadable` (nada é apagado: pode ser chave trocada) e o log traz só o nome do erro.
 */

/** O contexto autenticado junto do selo: um selo copiado para outra pessoa ou outro campo não abre. */
export function calendarTokenAad(userId: string): string {
  return `user:${userId}:google:calendar_refresh_token`
}

export function sealCalendarToken(userId: string, plain: string): string {
  return sealSecret(plain, calendarTokenAad(userId))
}

export type OpenedCalendarToken = { kind: 'open'; refreshToken: string; sealed: string } | { kind: 'unreadable'; sealed: string }

/** O token de renovação (e o selo de onde saiu) de uma ligação ativa; `unreadable` com selo que não abre; `null` sem ligação ativa. */
export async function openCalendarToken(userId: string): Promise<OpenedCalendarToken | null> {
  const row = await prisma.calendarConnection.findUnique({ where: { userId }, select: { status: true, refreshTokenEnc: true } })
  if (row === null || row.status !== 'CONNECTED' || row.refreshTokenEnc === null) return null
  try {
    return { kind: 'open', refreshToken: openSecret(row.refreshTokenEnc, calendarTokenAad(userId)), sealed: row.refreshTokenEnc }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'calendar_token_unreadable', error: err instanceof Error ? err.name : 'unknown' }))
    return { kind: 'unreadable', sealed: row.refreshTokenEnc }
  }
}

/** Abre um selo antigo já em mãos (para revogá-lo no Google); selo que não abre vira `null`. */
export function openSealedCalendarToken(userId: string, sealed: string): string | null {
  try {
    return openSecret(sealed, calendarTokenAad(userId))
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'calendar_token_unreadable', error: err instanceof Error ? err.name : 'unknown' }))
    return null
  }
}
