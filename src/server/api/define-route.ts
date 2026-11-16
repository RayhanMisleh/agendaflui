import 'server-only'
import { verifyAccessToken, type AccessClaims } from '@/server/auth/api-tokens'
import type { RequestInfo, TenantContext } from '@/server/auth/actor'
import { clientIp, ipLimitKeyPart } from '@/server/auth/client-ip'
import { createMemberContext, sessionInvalid } from '@/server/auth/context'
import { createCustomerContext } from '@/server/auth/customer-context'
import { hitRateLimit, LIMITS, limitKey, type LimitRule } from '@/server/auth/rate-limit-db'
import { DomainError, z } from '@/server/domain/errors'
import { ApiAuthError, resolveAppKey, type ResolvedKey } from '@/server/domain/platform/api-keys'
import { env } from '@/server/env'
import { corsHeaders, isSyntacticOrigin, originAllowed, preflightHeaders } from './cors'
import { ApiRateLimitError, BodyTooLargeError, buildResponse, errorResponse } from './errors'
import { registerRoute, type AnyRouteDef } from './registry'
import { toJson } from './serialize'

/*
 * Como escrever uma rota (`src/app/api/v1/**\/route.ts`):
 *
 *   export const GET = defineRoute({ method: 'GET', path: '/v1/algo/{id}', ... })
 *   export const OPTIONS = preflight   // uma vez por arquivo: responde o pré-voo CORS do navegador
 *
 * Validação: `params`, `query` e `body` chegam como texto/JSON; os esquemas da rota fazem a coerção
 * (`z.coerce.number()`). O objeto raiz de `body` e de `query` é tornado estrito aqui (campo desconhecido é erro 422);
 * objetos ANINHADOS precisam ser declarados com `z.strictObject` pelo autor da rota.
 */

export type RouteAuth = 'none' | 'key' | 'customer' | 'staff'

export type RouteDef<P, Q, B, R> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Caminho público, com parâmetros entre chaves: `/v1/appointments/{id}`. */
  path: string
  auth: RouteAuth
  summary: string
  tag: string
  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  body?: z.ZodType<B>
  /** Esquema da resposta de sucesso: documentação e teste de contrato (conferido fora de produção). */
  response: z.ZodType<R>
  status?: 200 | 201 | 202 | 204
  /** Limite da rota, além do limite geral por chave e IP. */
  limit?: LimitRule
  handler: (c: {
    ctx: TenantContext | null
    key: ResolvedKey | null
    params: P
    query: Q
    body: B
    request: Request
    now: Date
  }) => Promise<R>
}

export type RouteHandler = (request: Request, seg: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>

export const MAX_BODY_BYTES = 100 * 1024
const MAX_USER_AGENT = 300

/** Tira o nome do arquivo que chamou `defineRoute`, para distinguir recarga do mesmo arquivo de rota duplicada em outro. */
function callerSource(): string | null {
  for (const linha of (new Error().stack ?? '').split('\n').slice(1)) {
    const m = /\(?((?:file:\/\/)?[^()\s]+?):\d+:\d+\)?\s*$/.exec(linha)
    if (m?.[1] && !m[1].includes('define-route')) return m[1]
  }
  return null
}

function strictRoot<T>(schema: z.ZodType<T> | undefined): z.ZodType<T> | undefined {
  return schema instanceof z.ZodObject ? (schema.strict() as unknown as z.ZodType<T>) : schema
}

function invalidBody(message: string): DomainError {
  return new DomainError('validation', message, { fields: { _: message } })
}

function isJsonType(contentType: string | null): boolean {
  const tipo = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return tipo === 'application/json' || (tipo.startsWith('application/') && tipo.endsWith('+json'))
}

/** Lê o corpo como texto com teto de 100 KB medido em bytes (cabeçalho e leitura real). */
async function readBodyText(request: Request): Promise<string> {
  const declarado = request.headers.get('content-length')
  if (declarado !== null && /^\d+$/.test(declarado) && Number(declarado) > MAX_BODY_BYTES) throw new BodyTooLargeError(MAX_BODY_BYTES)
  if (!isJsonType(request.headers.get('content-type'))) {
    throw invalidBody('Envie o corpo em JSON, com o cabeçalho Content-Type: application/json.')
  }
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new BodyTooLargeError(MAX_BODY_BYTES)
    }
    partes.push(value)
  }
  const bytes = new Uint8Array(total)
  let posicao = 0
  for (const parte of partes) {
    bytes.set(parte, posicao)
    posicao += parte.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidBody('O corpo precisa estar em UTF-8 válido.')
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const texto = await readBodyText(request)
  if (texto.trim() === '') throw invalidBody('O corpo está vazio. Envie um objeto JSON.')
  try {
    return JSON.parse(texto) as unknown
  } catch {
    throw invalidBody('O corpo não é um JSON válido. Confira vírgulas, aspas e chaves.')
  }
}

function queryOf(request: Request): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [nome, valor] of new URL(request.url).searchParams) {
    const atual = out[nome]
    if (atual === undefined) out[nome] = valor
    else out[nome] = Array.isArray(atual) ? [...atual, valor] : [atual, valor]
  }
  return out
}

function bearerToken(request: Request): string | null {
  const m = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')
  return m?.[1] ?? null
}

const origemNegada = (): ApiAuthError =>
  new ApiAuthError('forbidden', 'origin_not_allowed', 'Esta origem não pode usar a API. Peça ao suporte para liberá-la na chave do app.')

/**
 * Responde o pré-voo CORS (`OPTIONS`). O navegador não manda `X-App-Key` no pré-voo, então ele não resolve a chave:
 * qualquer origem http(s) bem formada recebe os cabeçalhos (o pré-voo não libera dado nenhum). A checagem de verdade
 * da origem acontece na requisição real, que traz a chave. Cada `route.ts` faz `export const OPTIONS = preflight`.
 */
export async function preflight(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const origin = request.headers.get('origin')
  if (origin === null) return buildResponse(204, null, requestId)
  if (!isSyntacticOrigin(origin)) return errorResponse(origemNegada(), request, { requestId, route: '(pré-voo)' })
  return buildResponse(204, null, requestId, preflightHeaders(origin))
}

async function authenticate(
  def: AnyRouteDef,
  request: Request,
  key: ResolvedKey,
  now: Date,
  info: RequestInfo,
): Promise<TenantContext | null> {
  if (def.auth !== 'customer' && def.auth !== 'staff') return null
  const token = bearerToken(request)
  const claims: AccessClaims | null = token === null ? null : await verifyAccessToken(token, now)
  // Token ausente, inválido, vencido ou de outra conta: a mesma resposta nos três casos.
  if (!claims || claims.businessId !== key.businessId) throw sessionInvalid()
  if (claims.kind !== def.auth) {
    throw new ApiAuthError('forbidden', 'wrong_token_kind', 'Este endereço não aceita este tipo de login. Entre com a conta certa.')
  }
  if (claims.kind === 'customer') {
    return createCustomerContext({ businessId: key.businessId, customerId: claims.customerId, request: info })
  }
  return createMemberContext({
    businessId: key.businessId,
    membershipId: claims.membershipId,
    userId: claims.userId,
    request: info,
  })
}

async function enforceLimits(def: AnyRouteDef, request: Request, key: ResolvedKey, now: Date): Promise<void> {
  const ip = clientIp(request.headers, env.TRUSTED_PROXY_HOPS)
  const quem = `${key.apiKeyId}:${ip === null ? 'sem-ip' : ipLimitKeyPart(ip)}`
  const geral = await hitRateLimit(limitKey('api', quem), LIMITS.apiKeyIp, now)
  if (!geral.allowed) throw new ApiRateLimitError(geral.retryAfterSec)
  if (def.limit) {
    const rota = await hitRateLimit(limitKey('api-rota', `${def.method} ${def.path}:${quem}`), def.limit, now)
    if (!rota.allowed) throw new ApiRateLimitError(rota.retryAfterSec)
  }
}

/**
 * Cria o handler de uma rota: chave de app, CORS, limites, token, validação, domínio, serialização e erros padronizados,
 * nessa ordem. A rota fica registrada para o documento OpenAPI.
 */
export function defineRoute<P, Q, B, R>(def: RouteDef<P, Q, B, R>): RouteHandler {
  const any = def as unknown as AnyRouteDef
  registerRoute(any, callerSource())
  const bodySchema = strictRoot(def.body)
  const querySchema = strictRoot(def.query)
  const status = def.status ?? 200

  return async (request, seg) => {
    const requestId = crypto.randomUUID()
    let cors: Record<string, string> = {}
    const finish = (res: Response): Response => {
      for (const [nome, valor] of Object.entries(cors)) res.headers.set(nome, valor)
      return res
    }
    try {
      const now = new Date()
      const origin = request.headers.get('origin')
      let key: ResolvedKey | null = null
      if (def.auth === 'none') {
        // Sem chave não há o que conferir: só origem bem formada recebe CORS (health e openapi não expõem dado de conta).
        if (origin !== null) {
          if (!isSyntacticOrigin(origin)) throw origemNegada()
          cors = corsHeaders(origin)
        }
      } else {
        key = await resolveAppKey({ key: request.headers.get('x-app-key'), businessSlug: request.headers.get('x-business'), now })
        if (origin !== null) {
          if (!originAllowed(origin, key.allowedOrigins)) throw origemNegada()
          cors = corsHeaders(origin)
        }
        await enforceLimits(any, request, key, now)
      }

      const info: RequestInfo = {
        ip: clientIp(request.headers, env.TRUSTED_PROXY_HOPS),
        userAgent: request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null,
      }
      const ctx = key === null ? null : await authenticate(any, request, key, now, info)

      const params = def.params ? await def.params.parseAsync(await seg?.params) : (undefined as P)
      const query = querySchema ? await querySchema.parseAsync(queryOf(request)) : (undefined as Q)
      const body = bodySchema ? await bodySchema.parseAsync(await readJsonBody(request)) : (undefined as B)

      const result = await def.handler({ ctx, key, params, query, body, request, now })

      if (env.NODE_ENV !== 'production') {
        const conferido = await def.response.safeParseAsync(result)
        if (!conferido.success) {
          const problemas = conferido.error.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`).join('; ')
          throw new Error(`A resposta de ${def.method} ${def.path} não segue o esquema "response" (${problemas}).`)
        }
      }
      return finish(buildResponse(status, status === 204 ? null : toJson(result), requestId))
    } catch (err) {
      return finish(errorResponse(err, request, { requestId, route: def.path }))
    }
  }
}
