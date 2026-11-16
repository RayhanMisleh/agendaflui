import 'server-only'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey } from './rate-limit-db'

/**
 * Chaves de limite do login, com `<area>` = `painel` ou `dev`:
 * `login:<area>:email-ip:<e-mail>|<ip>` (5), `login:<area>:ip:<ip>` (20) e `login:<area>:email:<e-mail>`
 * (teto largo, 30) quando há IP confiável; `login:<area>:email-sem-ip:<e-mail>` (5) quando não há.
 * O IPv6 entra como /64 expandido.
 */
export type LoginArea = 'painel' | 'dev'

const chaveEmailLargo = (area: LoginArea, email: string): string => limitKey(`login:${area}:email`, email)
const chaveEmailSemIp = (area: LoginArea, email: string): string => limitKey(`login:${area}:email-sem-ip`, email)
const chaveEmailIp = (area: LoginArea, email: string, ip: string): string =>
  limitKey(`login:${area}:email-ip`, `${email}|${ipLimitKeyPart(ip)}`)

type Resultado = Awaited<ReturnType<typeof hitRateLimit>>

function barrarSeNegado(resultados: Resultado[]): void {
  const negados = resultados.filter((r) => !r.allowed)
  if (negados.length > 0) throw new AuthError('rate_limited', Math.max(...negados.map((r) => r.retryAfterSec)))
}

/**
 * Conta a tentativa de entrada e barra com `AuthError('rate_limited', espera)` se algum limite negar.
 * Com IP confiável conta primeiro e-mail+IP e IP; só se as duas permitirem conta o teto largo do
 * e-mail. Assim uma origem bloqueada não consome o teto, e cada IP (ou /64) soma no máximo 5 por
 * janela nele: travar o dono em todos os IPs exige várias origens. Sem IP: e-mail sozinho (5).
 */
export async function checkLoginLimit(area: LoginArea, email: string, ip: string | undefined, now: Date): Promise<void> {
  if (!ip) {
    barrarSeNegado([await hitRateLimit(chaveEmailSemIp(area, email), LIMITS.loginEmail, now)])
    return
  }
  const porOrigem = [
    await hitRateLimit(chaveEmailIp(area, email, ip), LIMITS.loginEmailIp, now),
    await hitRateLimit(limitKey(`login:${area}:ip`, ipLimitKeyPart(ip)), LIMITS.loginIp, now),
  ]
  barrarSeNegado(porOrigem)
  barrarSeNegado([await hitRateLimit(chaveEmailLargo(area, email), LIMITS.loginEmailWide, now)])
}

/** No sucesso: limpa as chaves de e-mail do caminho (com IP: e-mail+IP e largo; sem IP: sem-ip); nunca a do IP. */
export async function clearLoginLimit(area: LoginArea, email: string, ip?: string): Promise<void> {
  if (!ip) return clearRateLimit(chaveEmailSemIp(area, email))
  await clearRateLimit(chaveEmailLargo(area, email))
  await clearRateLimit(chaveEmailIp(area, email, ip))
}
