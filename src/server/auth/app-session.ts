import 'server-only'
import { revokeRefreshToken, rotateRefreshToken, type RequestMeta, type SubjectKind, type TokenPair } from '@/server/auth/api-tokens'
import { ApiAuthError } from '@/server/domain/platform/api-keys'

/**
 * Renovação da sessão do app (cliente ou equipe). Um token de renovação do outro tipo de sujeito é tratado como
 * inválido ANTES de qualquer alteração: nada é consumido nem revogado.
 */
export async function refreshAppSession(
  kind: SubjectKind,
  businessId: string,
  refreshToken: string,
  meta: RequestMeta,
  now: Date,
): Promise<TokenPair> {
  const result = await rotateRefreshToken(businessId, refreshToken, meta, now, kind)
  if (!result || result.claims.kind !== kind) {
    throw new ApiAuthError('unauthorized', 'invalid_refresh_token', 'Sua sessão venceu. Entre de novo.')
  }
  return result.pair
}

/** Saída do app: revoga a família do token. Token desconhecido, malformado ou do outro tipo não faz nada. */
export function logoutAppSession(kind: SubjectKind, businessId: string, refreshToken: string, now: Date): Promise<void> {
  return revokeRefreshToken(businessId, refreshToken, now, kind)
}
