import 'server-only'
import { openSecret, sealSecret } from '@/server/auth/secret-box'
import { prisma } from '@/server/db/client'

/*
 * LEITURA e selo do token de renovação do Google Agenda de cada pessoa. É o único arquivo que abre esse segredo: só
 * `src/server/calendar/**` pode importá-lo (o ESLint e `tests/unit/calendar-token-imports.test.ts` conferem). O texto puro
 * nunca sai daqui para tela, log, auditoria ou erro; selo que não abre vira `null` e o log traz só o nome do erro.
 */

/** O contexto autenticado junto do selo: um selo copiado para outra pessoa ou outro campo não abre. */
export function calendarTokenAad(userId: string): string {
  return `user:${userId}:google:calendar_refresh_token`
}

export function sealCalendarToken(userId: string, plain: string): string {
  return sealSecret(plain, calendarTokenAad(userId))
}

/** O token de renovação (e o selo de onde saiu) de uma ligação ativa; `null` sem ligação ativa ou com selo que não abre. */
export async function openCalendarToken(userId: string): Promise<{ refreshToken: string; sealed: string } | null> {
  const row = await prisma.calendarConnection.findUnique({ where: { userId }, select: { status: true, refreshTokenEnc: true } })
  if (row === null || row.status !== 'CONNECTED' || row.refreshTokenEnc === null) return null
  try {
    return { refreshToken: openSecret(row.refreshTokenEnc, calendarTokenAad(userId)), sealed: row.refreshTokenEnc }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'calendar_token_unreadable', error: err instanceof Error ? err.name : 'unknown' }))
    return null
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
