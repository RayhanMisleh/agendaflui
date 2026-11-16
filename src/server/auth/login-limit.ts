import 'server-only'
import { AuthError } from './actor'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey } from './rate-limit-db'

/** Chaves de limite do login: `login:<painel|dev>:email:<e-mail>` e `login:<painel|dev>:ip:<ip>`. */
export type LoginArea = 'painel' | 'dev'

const chaveEmail = (area: LoginArea, email: string): string => limitKey(`login:${area}:email`, email)

/**
 * Conta a tentativa de entrada por IP (só quando há IP confiável) e por e-mail; barra com
 * `AuthError('rate_limited', espera)` quando qualquer um passar do limite.
 */
export async function checkLoginLimit(area: LoginArea, email: string, ip: string | undefined, now: Date): Promise<void> {
  const resultados = []
  if (ip) resultados.push(await hitRateLimit(limitKey(`login:${area}:ip`, ip), LIMITS.loginIp, now))
  resultados.push(await hitRateLimit(chaveEmail(area, email), LIMITS.loginEmail, now))
  const negados = resultados.filter((r) => !r.allowed)
  if (negados.length > 0) throw new AuthError('rate_limited', Math.max(...negados.map((r) => r.retryAfterSec)))
}

export function clearLoginLimit(area: LoginArea, email: string): Promise<void> {
  return clearRateLimit(chaveEmail(area, email))
}
