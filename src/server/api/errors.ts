import { AuthError } from '@/server/auth/actor'
import { ApiAuthError } from '@/server/domain/platform/api-keys'
import { DomainError, z, zodFields, type DomainErrorCode } from '@/server/domain/errors'
import { toJson } from './serialize'

/** Corpo acima do teto: 413. */
export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`O corpo da requisição passa de ${Math.round(maxBytes / 1024)} KB. Envie menos dados.`)
    this.name = 'BodyTooLargeError'
  }
}

/** Limite de requisições da API estourado: 429 com `Retry-After`. */
export class ApiRateLimitError extends Error {
  retryAfterSec: number
  constructor(retryAfterSec: number) {
    super(`Muitas requisições. Tente de novo em ${retryAfterSec} ${retryAfterSec === 1 ? 'segundo' : 'segundos'}.`)
    this.name = 'ApiRateLimitError'
    this.retryAfterSec = retryAfterSec
  }
}

const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  validation: 422,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  business_unavailable: 503,
  module_disabled: 404,
}

const AUTH_STATUS = { unauthorized: 401, forbidden: 403, business_unavailable: 503 } as const

export type ErrorMeta = {
  /** Id da requisição; sem ele, um novo é gerado. */
  requestId?: string
  /** Padrão da rota (`/v1/appointments/{id}`), nunca o caminho com valores. */
  route?: string
}

export type ErrorBody = {
  error: { code: string; reason?: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> }
}

/** Resposta JSON padrão da API (corpo `null` = sem corpo), com os cabeçalhos que toda resposta leva. */
export function buildResponse(status: number, body: unknown, requestId: string, extra: Record<string, string> = {}): Response {
  const headers = new Headers({ 'cache-control': 'no-store', 'x-request-id': requestId, ...extra })
  if (body === null || status === 204) return new Response(null, { status, headers })
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

function errorBody(code: string, message: string, extra: Omit<ErrorBody['error'], 'code' | 'message'> = {}): ErrorBody {
  return { error: { code, ...extra, message } }
}

function logInternal(err: unknown, request: Request, requestId: string, route: string): void {
  const e = err instanceof Error ? err : new Error(`Valor lançado que não é Error: ${typeof err}`)
  // Só o necessário para achar o problema: nunca cabeçalhos, corpo, chave de app nem token.
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'api_internal_error',
      requestId,
      method: request.method,
      route,
      name: e.name,
      message: e.message,
      stack: e.stack,
    }),
  )
}

const MENSAGEM_INTERNA = 'Algo deu errado do nosso lado. Tente de novo em instantes.'

/** Único lugar que transforma um erro em resposta da API. Erro desconhecido vira 500 genérico e é registrado no log; nunca lança. */
export function errorResponse(err: unknown, request: Request, meta: ErrorMeta = {}): Response {
  const requestId = meta.requestId ?? crypto.randomUUID()
  try {
    return mapError(err, request, requestId, meta.route ?? '-')
  } catch (falha) {
    // Falhou ao montar a resposta (por exemplo, `details` que não serializa): registra e responde o 500 padrão.
    logInternal(falha, request, requestId, meta.route ?? '-')
    return buildResponse(500, errorBody('internal', MENSAGEM_INTERNA), requestId)
  }
}

function mapError(err: unknown, request: Request, requestId: string, route: string): Response {
  if (err instanceof DomainError) {
    const body = errorBody(err.code, err.message, {
      ...(err.reason !== undefined ? { reason: err.reason } : {}),
      ...(err.fields !== undefined ? { fields: err.fields } : {}),
      ...(err.details !== undefined ? { details: toJson(err.details) as Record<string, unknown> } : {}),
    })
    return buildResponse(DOMAIN_STATUS[err.code], body, requestId)
  }
  if (err instanceof ApiAuthError) {
    return buildResponse(AUTH_STATUS[err.code], errorBody(err.code, err.message, { reason: err.reason }), requestId)
  }
  if (err instanceof ApiRateLimitError) {
    return buildResponse(429, errorBody('rate_limited', err.message), requestId, { 'retry-after': String(err.retryAfterSec) })
  }
  if (err instanceof AuthError) {
    if (err.code === 'rate_limited') {
      return buildResponse(429, errorBody('rate_limited', err.message), requestId, {
        'retry-after': String(Math.max(1, Math.ceil(err.retryAfterSec ?? 1))),
      })
    }
    if (err.code === 'business_unavailable') return buildResponse(503, errorBody('business_unavailable', err.message), requestId)
    if (err.code === 'no_access') return buildResponse(403, errorBody('forbidden', err.message, { reason: err.code }), requestId)
    return buildResponse(401, errorBody('unauthorized', err.message, { reason: err.code }), requestId)
  }
  if (err instanceof BodyTooLargeError) {
    return buildResponse(413, errorBody('validation', err.message, { reason: 'body_too_large' }), requestId)
  }
  if (err instanceof z.ZodError) {
    return buildResponse(422, errorBody('validation', 'Confira os campos informados e tente de novo.', { fields: zodFields(err, { perUnknownKey: true }) }), requestId)
  }
  logInternal(err, request, requestId, route)
  return buildResponse(500, errorBody('internal', MENSAGEM_INTERNA), requestId)
}
