import 'server-only'
import { openSecret } from '@/server/auth/secret-box'
import { prisma } from '@/server/db/client'
import { GOOGLE_SECRET_AAD } from './google-settings'

/*
 * LEITURA da chave secreta do cliente do Google em texto puro. Sem ator: quem chama é o login com Google, que precisa
 * dela para trocar o código por token. Por isso só `src/server/auth/google/**` pode importar este arquivo (o teste
 * `google-secrets-imports.test.ts` varre `src/`). O texto puro nunca sai daqui para tela, log, auditoria ou erro. Selo
 * que não abre vira `null` e o log traz só o nome do erro.
 */

/** ID e chave do cliente do Google; `null` se não estão configurados ou se o selo não abre. */
export async function readGoogleClient(): Promise<{ clientId: string; clientSecret: string } | null> {
  const row = await prisma.platformSetting.findUnique({ where: { id: 1 }, select: { googleClientId: true, googleClientSecretEnc: true } })
  if (row === null || row.googleClientId === null || row.googleClientSecretEnc === null) return null
  try {
    return { clientId: row.googleClientId, clientSecret: openSecret(row.googleClientSecretEnc, GOOGLE_SECRET_AAD) }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'google_secret_unreadable', error: err instanceof Error ? err.name : 'unknown' }))
    return null
  }
}
