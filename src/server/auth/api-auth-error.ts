import type { ApiReason } from '@/server/domain/errors'

/** Falha de autenticação na API do app (conta, origem ou token). As rotas HTTP mapeiam para 401, 403 e 503. */
export class ApiAuthError extends Error {
  code: 'unauthorized' | 'forbidden' | 'business_unavailable'
  reason: ApiReason
  constructor(code: ApiAuthError['code'], reason: ApiReason, message: string) {
    super(message)
    this.name = 'ApiAuthError'
    this.code = code
    this.reason = reason
  }
}
