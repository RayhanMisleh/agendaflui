import 'server-only'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey } from './rate-limit-db'

/**
 * Chaves de limite do login, com `<area>` = `painel` ou `dev`:
 * `login:<area>:email:<e-mail>`, `login:<area>:email-ip:<e-mail>|<ip>` e `login:<area>:ip:<ip>`
 * (o IPv6 entra como /64 expandido).
 */
export type LoginArea = 'painel' | 'dev'

const chaveEmail = (area: LoginArea, email: string): string => limitKey(`login:${area}:email`, email)
const chaveEmailIp = (area: LoginArea, email: string, ip: string): string =>
  limitKey(`login:${area}:email-ip`, `${email}|${ipLimitKeyPart(ip)}`)

/**
 * Conta a tentativa de entrada e barra com `AuthError('rate_limited', espera)` se qualquer limite negar.
 * Com IP confiável: e-mail+IP (5), e-mail sozinho (teto largo, 30) e IP (20), para que quem só sabe o
 * e-mail de alguém não consiga travá-lo para todos. Sem IP: e-mail sozinho (5).
 */
export async function checkLoginLimit(area: LoginArea, email: string, ip: string | undefined, now: Date): Promise<void> {
  const resultados = []
  if (ip) {
    resultados.push(await hitRateLimit(chaveEmailIp(area, email, ip), LIMITS.loginEmailIp, now))
    resultados.push(await hitRateLimit(chaveEmail(area, email), LIMITS.loginEmailWide, now))
    resultados.push(await hitRateLimit(limitKey(`login:${area}:ip`, ipLimitKeyPart(ip)), LIMITS.loginIp, now))
  } else {
    resultados.push(await hitRateLimit(chaveEmail(area, email), LIMITS.loginEmail, now))
  }
  const negados = resultados.filter((r) => !r.allowed)
  if (negados.length > 0) throw new AuthError('rate_limited', Math.max(...negados.map((r) => r.retryAfterSec)))
}

/** No sucesso: limpa e-mail+IP (se houver IP) e e-mail sozinho; nunca a chave do IP. */
export async function clearLoginLimit(area: LoginArea, email: string, ip?: string): Promise<void> {
  await clearRateLimit(chaveEmail(area, email))
  if (ip) await clearRateLimit(chaveEmailIp(area, email, ip))
}
