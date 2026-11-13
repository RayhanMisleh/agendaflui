import type { MembershipRole } from '@/server/db/generated/client'

export type Actor =
  | { kind: 'platform_admin'; adminId: string; name: string }
  | { kind: 'member'; userId: string; name: string; role: MembershipRole }
  | { kind: 'impersonator'; adminId: string; name: string }
  | { kind: 'system' }

export type TenantContext = { businessId: string; timeZone: string; actor: Actor }

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

export class AuthError extends Error {
  code: AuthErrorCode
  constructor(code: AuthErrorCode) {
    super(MENSAGENS[code])
    this.name = 'AuthError'
    this.code = code
  }
}
