import type { MembershipRole } from '@/server/db/generated/client'
import type { TenantClient } from '@/server/db/tenant'

export type Actor =
  | { kind: 'platform_admin'; adminId: string; name: string }
  | { kind: 'member'; userId: string; membershipId: string; name: string; role: MembershipRole }
  | { kind: 'impersonator'; adminId: string; name: string }
  | { kind: 'customer'; customerId: string; name: string }
  | { kind: 'system' }
  /** Quem usa o app sem entrar: lê o que é público (catálogo, disponibilidade) e não grava nada. */
  | { kind: 'guest' }

export type RequestInfo = { ip: string | null; userAgent: string | null }

/** Por onde a ação chegou: o aplicativo, o painel da conta ou o próprio sistema (tarefas internas). */
export type Channel = 'app' | 'panel' | 'system'

export type TenantContext = {
  businessId: string
  timeZone: string
  actor: Actor
  /** Cliente por conta, criado uma vez por contexto. */
  db: TenantClient
  clock: () => Date
  request: RequestInfo
  channel: Channel
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'account_inactive'
  | 'business_unavailable'
  | 'no_access'

const MENSAGENS: Record<AuthErrorCode, string> = {
  invalid_credentials: 'E-mail ou senha incorretos. Confira os dados e tente de novo.',
  rate_limited: 'Muitas tentativas de entrada. Aguarde alguns minutos e tente de novo.',
  account_inactive: 'Esta conta de acesso está desativada. Fale com o suporte.',
  business_unavailable: 'Esta conta não está disponível agora. Fale com o suporte.',
  no_access: 'Você não tem acesso a esta conta. Escolha outra.',
}

/** "Muitas tentativas. Tente de novo em N minutos." com a espera arredondada para cima. */
export function mensagemDeEspera(retryAfterSec: number): string {
  const minutos = Math.max(1, Math.ceil(retryAfterSec / 60))
  return `Muitas tentativas. Tente de novo em ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`
}

export class AuthError extends Error {
  code: AuthErrorCode
  /** Segundos até a próxima tentativa; só em `rate_limited`. */
  retryAfterSec?: number
  constructor(code: AuthErrorCode, retryAfterSec?: number) {
    super(code === 'rate_limited' && retryAfterSec !== undefined ? mensagemDeEspera(retryAfterSec) : MENSAGENS[code])
    this.name = 'AuthError'
    this.code = code
    if (retryAfterSec !== undefined) this.retryAfterSec = retryAfterSec
  }
}
