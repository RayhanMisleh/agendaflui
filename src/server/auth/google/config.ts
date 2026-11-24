import 'server-only'
import { readGoogleClient } from '@/server/domain/platform/google-secrets'

/** As chaves do cliente do Google em texto, ou `null` sem chaves (ou com selo ruim). O único importador do leitor restrito. */
export async function googleClient(): Promise<{ clientId: string; clientSecret: string } | null> {
  return readGoogleClient()
}
