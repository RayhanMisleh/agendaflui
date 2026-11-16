import type { Actor } from '@/server/auth/actor'
import { signAccessToken } from '@/server/auth/api-tokens'
import type { RouteHandler } from '@/server/api/define-route'
import { createApiKey } from '@/server/domain/platform/api-keys'
import { makePlatformAdmin } from './factories'

const BASE = 'http://api.localhost:3000'

type RequestOptions = {
  key?: string
  business?: string
  token?: string
  /** Texto vai como está (para testar JSON inválido); qualquer outro valor vira JSON. */
  body?: unknown
  origin?: string
  headers?: Record<string, string>
}

/** Monta um `Request` para a API. Com `body`, manda `Content-Type: application/json` (a menos que `headers` diga outra coisa). */
export function apiRequest(method: string, path: string, o: RequestOptions = {}): Request {
  const headers = new Headers()
  if (o.key !== undefined) headers.set('x-app-key', o.key)
  if (o.business !== undefined) headers.set('x-business', o.business)
  if (o.token !== undefined) headers.set('authorization', `Bearer ${o.token}`)
  if (o.origin !== undefined) headers.set('origin', o.origin)
  let body: string | undefined
  if (o.body !== undefined) {
    body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body)
    headers.set('content-type', 'application/json')
  }
  for (const [nome, valor] of Object.entries(o.headers ?? {})) headers.set(nome, valor)
  return new Request(`${BASE}${path}`, body === undefined ? { method, headers } : { method, headers, body })
}

export type CalledRoute = {
  status: number
  headers: Headers
  /** Corpo já lido como JSON (`null` quando não há corpo). Use `jsonObject` ou `apiError` para ler. */
  json: unknown
  text: string
}

/** Chama o handler exportado de uma rota, como o Next faz, sem subir servidor. */
export async function callRoute(handler: RouteHandler, req: Request, params: Record<string, string> = {}): Promise<CalledRoute> {
  const res = await handler(req, { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, headers: res.headers, json: text === '' ? null : (JSON.parse(text) as unknown), text }
}

/** O corpo como objeto; falha se não for. */
export function jsonObject(json: unknown): Record<string, unknown> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('O corpo da resposta não é um objeto JSON.')
  return json as Record<string, unknown>
}

export type ApiErrorBody = {
  code: string
  reason?: string
  message: string
  fields?: Record<string, string>
  details?: Record<string, unknown>
}

/** O objeto `error` de uma resposta de erro; falha se o corpo não tiver o formato padrão. */
export function apiError(json: unknown): ApiErrorBody {
  const erro = jsonObject(json).error
  if (typeof erro !== 'object' || erro === null) throw new Error('A resposta não tem o formato de erro padrão.')
  return erro as ApiErrorBody
}

/** Cria uma chave de app (de conta com `businessId`, de plataforma com `null`) e devolve o segredo e o id. */
export async function makeAppKey(
  businessId: string | null,
  o: { allowedOrigins?: string[] } = {},
): Promise<{ secret: string; id: string }> {
  const admin = await makePlatformAdmin()
  const actor: Extract<Actor, { kind: 'platform_admin' }> = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
  const { key, secret } = await createApiKey(actor, {
    kind: businessId === null ? 'PLATFORM' : 'ACCOUNT',
    ...(businessId === null ? {} : { businessId }),
    name: 'Chave de teste',
    allowedOrigins: o.allowedOrigins ?? [],
  })
  return { secret, id: key.id }
}

export async function customerToken(businessId: string, customerId: string): Promise<string> {
  return (await signAccessToken({ kind: 'customer', businessId, customerId }, new Date())).token
}

export async function staffToken(businessId: string, membershipId: string, userId: string): Promise<string> {
  return (await signAccessToken({ kind: 'staff', businessId, membershipId, userId }, new Date())).token
}
