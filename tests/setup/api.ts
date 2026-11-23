import { signAccessToken } from '@/server/auth/api-tokens'
import { setAfterScheduler } from '@/server/api/after'
import type { RouteHandler } from '@/server/api/define-route'

const BASE = 'http://api.localhost:3000'

type RequestOptions = {
  /** Slug da conta, no cabeçalho `X-Business`. */
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

export async function customerToken(businessId: string, customerId: string): Promise<string> {
  return (await signAccessToken({ kind: 'customer', businessId, customerId }, new Date())).token
}

export async function staffToken(businessId: string, membershipId: string, userId: string): Promise<string> {
  return (await signAccessToken({ kind: 'staff', businessId, membershipId, userId }, new Date())).token
}

// `after` do Next lança fora de uma requisição real: nos testes, o trabalho adiado fica numa fila que só roda em `flushAfter`.
const adiadas: (() => Promise<void>)[] = []
setAfterScheduler((task) => {
  adiadas.push(task)
})

/** Executa (em paralelo) e aguarda o trabalho que as rotas agendaram para depois da resposta. */
export async function flushAfter(): Promise<void> {
  for (let guarda = 0; adiadas.length > 0 && guarda < 10; guarda++) {
    await Promise.all(adiadas.splice(0).map((t) => t()))
  }
}

/** Quantas tarefas adiadas estão esperando `flushAfter`. */
export const pendingAfter = (): number => adiadas.length
