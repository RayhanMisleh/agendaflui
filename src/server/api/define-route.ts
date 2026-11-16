import 'server-only'
import { verifyAccessToken, type AccessClaims } from '@/server/auth/api-tokens'
import type { RequestInfo, TenantContext } from '@/server/auth/actor'
import { clientIp, ipLimitKeyPart } from '@/server/auth/client-ip'
import { createMemberContext, sessionInvalid } from '@/server/auth/context'
import { createCustomerContext } from '@/server/auth/customer-context'
import { createGuestContext } from '@/server/auth/guest-context'
import { hitRateLimit, LIMITS, limitKey, type LimitRule } from '@/server/auth/rate-limit-db'
import { DomainError, z } from '@/server/domain/errors'
import { ApiAuthError, resolveAppKey, type ResolvedKey } from '@/server/domain/platform/api-keys'
import { env } from '@/server/env'
import { checkWireContract } from './contract'
import { corsHeaders, isSyntacticOrigin, originAllowed, preflightHeaders } from './cors'
import { ApiRateLimitError, BodyTooLargeError, buildResponse, errorResponse } from './errors'
import { requestMeta } from './request-meta'
import { toJson } from './serialize'
import { recordUsage } from './usage'

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

/**
 * `none`: sem chave. `key`: só a chave de app (o handler recebe o contexto de visitante). `customer` e `staff`: chave mais
 * token do tipo. `key_or_customer`: sem `Authorization` é visitante; com `Authorization` o token precisa ser de cliente válido
 * (nunca rebaixa em silêncio para visitante).
 */
export type RouteAuth = 'none' | 'key' | 'key_or_customer' | 'customer' | 'staff'

/**
 * O que o handler recebe de `ctx` e `key`, por tipo de autenticação. É o ÚNICO lugar que liga o tipo do contexto ao
 * tipo de autenticação: toda rota com chave tem `ctx` (visitante, cliente ou equipe, conforme o caso).
 */
export type AuthArgs<A extends RouteAuth> = A extends 'none' ? { ctx: null; key: null } : { ctx: TenantContext; key: ResolvedKey }

/**
 * O que o handler pode devolver para uma resposta de formato `R`: o próprio `R`, mais `Date` onde o fio diz texto
 * e `bigint` onde diz número (o `toJson` converte). Literais e uniões de texto continuam exatos.
 */
export type Serializable<R> = R extends string
  ? string extends R
    ? R | Date
    : R
  : R extends number
    ? number extends R
      ? R | bigint
      : R
    : R extends readonly (infer U)[]
      ? Serializable<U>[]
      : R extends object
        ? { [K in keyof R]: Serializable<R[K]> }
        : R

export type RouteDef<A extends RouteAuth, P, Q, B, R> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Caminho público, com parâmetros entre chaves: `/v1/appointments/{id}`. */
  path: string
  auth: A
  summary: string
  tag: string
  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  body?: z.ZodType<B>
  /**
   * Corpo opcional: sem corpo (ou vazio), o handler recebe `{}` e a validação segue normal. Sem esta opção, corpo ausente
   * em rota com `body` é erro 422. No OpenAPI, `requestBody.required` fica `false`.
   */
  bodyOptional?: true
  /**
   * Esquema da resposta de sucesso no FORMATO DE FIO (o JSON que sai): instantes como `isoInstant`, números como
   * `z.number()`, nunca `z.date()` nem `z.bigint()`. Fora de produção a resposta é conferida de forma estrita
   * (tipo errado ou campo a mais em qualquer nível vira erro de programação). Vira JSON Schema no OpenAPI.
   */
  response: z.ZodType<R>
  status?: 200 | 201 | 202 | 204
  /** Outros status de sucesso que o handler pode escolher com `setStatus` (só documentação para o OpenAPI, e a lista que `setStatus` aceita). */
  alternateStatuses?: readonly (200 | 201 | 202)[]
  /** Limite da rota, além do limite geral por chave e IP. */
  limit?: LimitRule
  /**
   * Com `'subject'`, o limite da rota conta por chave de app e pessoa autenticada (cliente ou vínculo da equipe, não por IP);
   * sem pessoa autenticada (visitante), cai no IP. O limite é conferido depois de validar o token.
   */
  limitBy?: 'subject'
  /** Só documentação (OpenAPI): a rota aceita o cabeçalho `Idempotency-Key`, que o handler repassa ao domínio. */
  idempotent?: true
  /**
   * Cache HTTP explícito do sucesso (`public, max-age=N`), só para resposta pública e igual para todos (o documento OpenAPI).
   * Sem isto, toda resposta sai com `Cache-Control: no-store`. Erros nunca são guardados.
   */
  cache?: A extends 'none' ? { maxAgeSec: number } : never
  handler: (
    c: AuthArgs<A> & {
      params: P
      query: Q
      body: B
      request: Request
      now: Date
      /** Troca o status de sucesso desta resposta (por exemplo 200 em vez do 201 da rota, numa repetição idempotente). */
      setStatus: (status: 200 | 201 | 202) => void
    },
  ) => Promise<Serializable<R>>
}

/** A forma apagada de uma rota, como o manifesto e o documento OpenAPI a leem. */
export type AnyRouteDef = RouteDef<RouteAuth, unknown, unknown, unknown, unknown>

export type RouteHandler = (request: Request, seg: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>

/** O handler que o Next chama, com a definição da rota anexada (o manifesto lê dela para montar o documento OpenAPI). */
export type DefinedRoute = RouteHandler & { readonly definition: AnyRouteDef }

export const MAX_BODY_BYTES = 100 * 1024

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
async function readBodyText(request: Request, optional: boolean): Promise<string> {
  const declarado = request.headers.get('content-length')
  if (declarado !== null && /^\d+$/.test(declarado) && Number(declarado) > MAX_BODY_BYTES) throw new BodyTooLargeError(MAX_BODY_BYTES)
  const semTipo = request.headers.get('content-type') === null
  if (!(optional && semTipo) && !isJsonType(request.headers.get('content-type'))) {
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

async function readJsonBody(request: Request, optional: boolean): Promise<unknown> {
  const texto = await readBodyText(request, optional)
  if (texto.trim() === '') {
    if (optional) return {}
    throw invalidBody('O corpo está vazio. Envie um objeto JSON.')
  }
  if (optional && request.headers.get('content-type') === null) {
    throw invalidBody('Envie o corpo em JSON, com o cabeçalho Content-Type: application/json.')
  }
  try {
    return JSON.parse(texto) as unknown
  } catch {
    throw invalidBody('O corpo não é um JSON válido. Confira vírgulas, aspas e chaves.')
  }
}

function queryOf(request: Request): Record<string, string | string[]> {
  // Sem protótipo: `?__proto__=x` vira um parâmetro comum (e é recusado), nunca passa em silêncio.
  const out: Record<string, string | string[]> = Object.create(null) as Record<string, string | string[]>
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
  if (!isSyntacticOrigin(origin)) {
    const negada = errorResponse(origemNegada(), request, { requestId, route: '(pré-voo)' })
    negada.headers.set('vary', 'Origin')
    return negada
  }
  return buildResponse(204, null, requestId, preflightHeaders(origin))
}

/**
 * Lê as declarações do token de acesso. Rotas `customer` e `staff` exigem token; `key_or_customer` aceita a ausência do
 * cabeçalho `Authorization` (visitante) mas nunca um token ruim; `key` ignora o cabeçalho. Token ausente, inválido,
 * vencido ou de outra conta: a mesma resposta 401 nos três casos.
 */
async function readClaims(def: AnyRouteDef, request: Request, key: ResolvedKey, now: Date): Promise<AccessClaims | null> {
  if (def.auth === 'none' || def.auth === 'key') return null
  if (def.auth === 'key_or_customer' && !request.headers.has('authorization')) return null
  const token = bearerToken(request)
  const claims = token === null ? null : await verifyAccessToken(token, now)
  if (!claims || claims.businessId !== key.businessId) throw sessionInvalid()
  const esperado = def.auth === 'staff' ? 'staff' : 'customer'
  if (claims.kind !== esperado) {
    throw new ApiAuthError('forbidden', 'wrong_token_kind', 'Este endereço não aceita este tipo de login. Entre com a conta certa.')
  }
  return claims
}

async function buildContext(key: ResolvedKey, claims: AccessClaims | null, info: RequestInfo): Promise<TenantContext> {
  if (claims === null) return createGuestContext({ businessId: key.businessId, timeZone: key.timeZone, request: info })
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

/** Conta uma tentativa com chave inválida por IP (só depois de constatar que a chave é inválida). Sem IP, não conta. */
async function countInvalidKey(request: Request, now: Date): Promise<void> {
  const ip = clientIp(request.headers, env.TRUSTED_PROXY_HOPS)
  if (ip === null) return
  const r = await hitRateLimit(limitKey('api-chave-invalida', ipLimitKeyPart(ip)), LIMITS.invalidKeyIp, now)
  if (!r.allowed) throw new ApiRateLimitError(r.retryAfterSec)
}

function whoIs(request: Request, key: ResolvedKey): string {
  const ip = clientIp(request.headers, env.TRUSTED_PROXY_HOPS)
  return `${key.apiKeyId}:${ip === null ? 'sem-ip' : ipLimitKeyPart(ip)}`
}

/** Limite geral por chave e IP: conferido antes de qualquer outro trabalho. */
async function enforceGeneralLimit(request: Request, key: ResolvedKey, now: Date): Promise<void> {
  const geral = await hitRateLimit(limitKey('api', whoIs(request, key)), LIMITS.apiKeyIp, now)
  if (!geral.allowed) throw new ApiRateLimitError(geral.retryAfterSec)
}

/** Limite da rota: por chave e IP, ou (com `limitBy: 'subject'` e pessoa autenticada) por chave e cliente ou vínculo da equipe. */
async function enforceRouteLimit(def: AnyRouteDef, request: Request, key: ResolvedKey, claims: AccessClaims | null, now: Date): Promise<void> {
  if (!def.limit) return
  const subject = claims === null ? null : claims.kind === 'customer' ? claims.customerId : claims.membershipId
  const quem = def.limitBy === 'subject' && subject !== null ? `${key.apiKeyId}:${subject}` : whoIs(request, key)
  const rota = await hitRateLimit(limitKey('api-rota', `${def.method} ${def.path}:${quem}`), def.limit, now)
  if (!rota.allowed) throw new ApiRateLimitError(rota.retryAfterSec)
}

/**
 * Cria o handler de uma rota: chave de app, CORS, limites, token, validação, domínio, serialização e erros padronizados,
 * nessa ordem. A definição vai anexada ao handler devolvido (`.definition`): o manifesto de rotas (`routes-manifest.ts`)
 * lê dela para montar o documento OpenAPI, sem depender de quais rotas o Next já carregou.
 */
export function defineRoute<A extends RouteAuth, P, Q, B, R>(def: RouteDef<A, P, Q, B, R>): DefinedRoute {
  const any = def as unknown as AnyRouteDef
  if (def.cache !== undefined && def.auth !== 'none') {
    throw new Error(`${def.method} ${def.path}: "cache" só vale para rota sem autenticação (auth: 'none'), porque a resposta é guardada por caches compartilhados.`)
  }
  const bodySchema = strictRoot(def.body)
  const querySchema = strictRoot(def.query)
  const status = def.status ?? 200
  const handle = def.handler as unknown as (c: Record<string, unknown>) => Promise<unknown>

  /** Registra o uso depois de a resposta estar pronta: só com chave válida, e nenhuma falha aqui muda a resposta. */
  const track = (key: ResolvedKey | null, status: number, started: number): void => {
    if (key === null) return
    try {
      const erro = status >= 500 || (status >= 400 && ![401, 404, 409, 422, 429].includes(status))
      recordUsage({ apiKeyId: key.apiKeyId, businessId: key.businessId, route: `${def.method} ${def.path}`, ms: performance.now() - started, error: erro, at: new Date() })
    } catch {
      // Métrica nunca muda a resposta.
    }
  }

  const handler: RouteHandler = async (request, seg) => {
    const started = performance.now()
    const holder: { key: ResolvedKey | null } = { key: null }
    const res = await respond(request, seg, holder)
    track(holder.key, res.status, started)
    return res
  }

  const respond = async (request: Request, seg: Parameters<RouteHandler>[1], holder: { key: ResolvedKey | null }): Promise<Response> => {
    const requestId = crypto.randomUUID()
    let cors: Record<string, string> = {}
    const finish = (res: Response): Response => {
      for (const [nome, valor] of Object.entries(cors)) res.headers.set(nome, valor)
      return res
    }
    try {
      const now = new Date()
      const origin = request.headers.get('origin')
      // A resposta depende da origem mesmo quando a origem é recusada.
      if (origin !== null) cors = { vary: 'Origin' }
      let key: ResolvedKey | null = null
      if (def.auth === 'none') {
        // Sem chave não há o que conferir: só origem bem formada recebe CORS (health e openapi não expõem dado de conta).
        if (origin !== null) {
          if (!isSyntacticOrigin(origin)) throw origemNegada()
          cors = corsHeaders(origin)
        }
      } else {
        try {
          key = await resolveAppKey({ key: request.headers.get('x-app-key'), businessSlug: request.headers.get('x-business'), now })
        } catch (e) {
          if (e instanceof ApiAuthError && e.reason === 'invalid_app_key') await countInvalidKey(request, now)
          throw e
        }
        if (origin !== null) {
          if (!originAllowed(origin, key.allowedOrigins)) throw origemNegada()
          cors = corsHeaders(origin)
        }
        holder.key = key
        await enforceGeneralLimit(request, key, now)
      }

      const info: RequestInfo = requestMeta(request)
      let ctx: TenantContext | null = null
      let claims: AccessClaims | null = null
      if (key !== null) {
        if (def.limitBy !== 'subject') await enforceRouteLimit(any, request, key, null, now)
        claims = await readClaims(any, request, key, now)
        if (def.limitBy === 'subject') await enforceRouteLimit(any, request, key, claims, now)
        ctx = await buildContext(key, claims, info)
      }

      const params = def.params ? await def.params.parseAsync(await seg?.params) : (undefined as P)
      const consulta = queryOf(request)
      if (!querySchema) {
        const nomes = Object.keys(consulta)
        if (nomes.length > 0) {
          const fields = Object.fromEntries(nomes.map((n) => [n, 'Parâmetro de consulta não reconhecido. Remova-o da requisição.']))
          throw new DomainError('validation', 'Confira os campos informados e tente de novo.', { fields })
        }
      }
      const query = querySchema ? await querySchema.parseAsync(consulta) : (undefined as Q)
      const body = bodySchema ? await bodySchema.parseAsync(await readJsonBody(request, def.bodyOptional === true)) : (undefined as B)

      let finalStatus: number = status
      const setStatus = (novo: 200 | 201 | 202): void => {
        if (novo !== status && !(def.alternateStatuses ?? []).includes(novo)) {
          throw new Error(`${def.method} ${def.path} pediu o status ${novo}, que não está em "status" nem em "alternateStatuses".`)
        }
        finalStatus = novo
      }
      const result = await handle({ ctx, key, params, query, body, request, now, setStatus })
      if (status === 204) return finish(buildResponse(204, null, requestId))
      const json = toJson(result)
      if (env.NODE_ENV !== 'production') {
        const problema = await checkWireContract(def.response, json)
        if (problema !== null) throw new Error(`A resposta de ${def.method} ${def.path} não segue o esquema "response": ${problema}.`)
      }
      const cache: Record<string, string> = def.cache ? { 'cache-control': `public, max-age=${def.cache.maxAgeSec}`, vary: 'Origin' } : {}
      return finish(buildResponse(finalStatus, json, requestId, cache))
    } catch (err) {
      return finish(errorResponse(err, request, { requestId, route: def.path }))
    }
  }
  return Object.assign(handler, { definition: any })
}
