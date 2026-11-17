import { MODULE_LABELS } from '@/shared/modules'
import { areaLink } from '@/server/area-links'
import { API_REASONS, DOMAIN_REASONS, z } from '@/server/domain/errors'
import { API_ERROR_CODES } from './errors'
import type { AnyRouteDef } from './define-route'
import { routeDefinitions } from './routes-manifest'

/*
 * Documento OpenAPI 3.1 gerado das definições das rotas (o manifesto em `routes-manifest.ts`), nunca de texto escrito
 * à mão. É a referência que o repositório do app consome. Nada interno entra aqui: só o que as definições declaram.
 */

type Json = Record<string, unknown>
export type OpenApiDocument = Json

const TOKEN_KINDS = 'o token de acesso de um cliente (rotas /v1/auth/customer e /v1/me) ou da equipe (/v1/auth/staff e /v1/staff)'

const ERROR_RESPONSES: Record<string, { name: string; description: string }> = {
  '401': { name: 'Unauthorized', description: 'Chave do app inválida, token ausente, inválido ou vencido, ou sessão encerrada.' },
  '403': { name: 'Forbidden', description: 'Sem permissão: origem não liberada, tipo de token errado ou papel sem acesso.' },
  '404': { name: 'NotFound', description: 'O registro não existe nesta conta (ou o módulo da rota está desligado: `error.code` é `module_disabled`).' },
  '409': { name: 'Conflict', description: 'A regra de negócio impede a ação agora: veja `error.reason`.' },
  '413': { name: 'PayloadTooLarge', description: 'O corpo passa de 100 KB: envie menos dados (`error.reason` é `body_too_large`).' },
  '422': { name: 'ValidationFailed', description: 'Os dados enviados não passaram na validação: veja `error.fields`.' },
  '429': { name: 'TooManyRequests', description: 'Limite de requisições estourado: espere o tempo de `Retry-After`.' },
  '500': { name: 'InternalError', description: 'Algo deu errado do nosso lado: tente de novo em instantes.' },
  '503': { name: 'ServiceUnavailable', description: 'A conta não está disponível agora: fale com o suporte.' },
}

const SUCCESS_TEXT: Record<number, string> = { 200: 'Sucesso.', 201: 'Criado.', 202: 'Aceito.', 204: 'Sucesso, sem corpo.' }

/** JSON Schema (2020-12, o dialeto do OpenAPI 3.1) de um esquema Zod. `input` para o que a API recebe, `output` para o que devolve. */
function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Json {
  const json = z.toJSONSchema(schema, { io, target: 'draft-2020-12' }) as Json
  delete json.$schema
  return json
}

/** Corpo e consulta da API recusam campo desconhecido na raiz (`defineRoute` torna o objeto raiz estrito): o documento diz o mesmo. */
function strictRoot(schema: Json): Json {
  return schema.type === 'object' && schema.additionalProperties === undefined ? { ...schema, additionalProperties: false } : schema
}

function parameters(schema: z.ZodType | undefined, where: 'path' | 'query'): Json[] {
  if (!schema) return []
  const json = jsonSchema(schema, 'input')
  const properties = (json.properties ?? {}) as Record<string, Json>
  const required = new Set(Array.isArray(json.required) ? (json.required as string[]) : [])
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property
    return {
      name,
      in: where,
      required: where === 'path' || required.has(name),
      description: typeof description === 'string' ? description : '',
      schema: rest,
    }
  })
}

const BUSINESS_HEADER: Json = {
  name: 'X-Business',
  in: 'header',
  required: false,
  description:
    'Endereço (slug) da conta. Obrigatório com a chave de plataforma; com a chave de uma conta, se enviado, precisa ser a mesma conta.',
  schema: { type: 'string' },
}

const IDEMPOTENCY_HEADER: Json = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description:
    'Chave de 1 a 80 caracteres (letras, números, "-" e "_"). Repetir o mesmo pedido com a mesma chave em até 24 horas devolve o mesmo agendamento (status 200), sem marcar de novo.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' },
}

function security(auth: AnyRouteDef['auth']): Json[] {
  switch (auth) {
    case 'none':
      return []
    case 'key':
      return [{ AppKey: [] }]
    case 'key_or_customer':
      return [{ AppKey: [] }, { AppKey: [], Bearer: [] }]
    case 'customer':
    case 'staff':
      return [{ AppKey: [], Bearer: [] }]
  }
}

const AUTH_TEXT: Record<AnyRouteDef['auth'], string> = {
  none: 'Não exige chave nem token.',
  key: 'Exige a chave do app (X-App-Key).',
  key_or_customer: 'Exige a chave do app. Com o token de um cliente (Authorization: Bearer) vale o que é do cliente; sem token, é visitante.',
  customer: 'Exige a chave do app e o token de acesso de um cliente.',
  staff: 'Exige a chave do app e o token de acesso da equipe.',
}

/** `getStaffAppointmentsByIdNoShow`: método em minúsculas, mais cada trecho do caminho em maiúscula inicial (`{id}` vira `ById`). */
export function operationId(method: string, path: string): string {
  const words = path
    .replace(/^\/v1\//, '')
    .split('/')
    .filter((segment) => segment !== '')
    .flatMap((segment) => (segment.startsWith('{') ? ['by', ...segment.slice(1, -1).split(/[^A-Za-z0-9]+/)] : segment.split(/[^A-Za-z0-9]+/)))
    .filter((word) => word !== '')
  return method.toLowerCase() + words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
}

const errorRef = (status: string): Json => ({ $ref: `#/components/responses/${ERROR_RESPONSES[status]?.name ?? ''}` })

export function operation(def: AnyRouteDef): Json {
  const success = def.status ?? 200
  const hasInput = def.params !== undefined || def.query !== undefined || def.body !== undefined
  const responses: Record<string, Json> = {}
  const successResponse = (status: number): Json =>
    status === 204
      ? { description: SUCCESS_TEXT[204] }
      : { description: SUCCESS_TEXT[status] ?? 'Sucesso.', content: { 'application/json': { schema: jsonSchema(def.response, 'output') } } }
  responses[String(success)] = successResponse(success)
  for (const status of def.alternateStatuses ?? []) responses[String(status)] = successResponse(status)
  const errors: string[] = []
  if (def.auth !== 'none') errors.push('401', '403')
  if (def.auth !== 'none' || def.params !== undefined) errors.push('404')
  if (def.method !== 'GET') errors.push('409')
  if (def.body !== undefined) errors.push('413')
  if (hasInput) errors.push('422')
  if (def.auth !== 'none') errors.push('429')
  errors.push('500', '503')
  for (const status of errors) responses[status] = errorRef(status)

  const params = [
    ...(def.auth === 'none' ? [] : [BUSINESS_HEADER]),
    ...(def.idempotent ? [IDEMPOTENCY_HEADER] : []),
    ...parameters(def.params, 'path'),
    ...parameters(def.query, 'query'),
  ]
  return {
    operationId: operationId(def.method, def.path),
    summary: def.summary,
    description: def.module === undefined ? AUTH_TEXT[def.auth] : `${AUTH_TEXT[def.auth]} Exige o módulo ${MODULE_LABELS[def.module]} ligado.`,
    tags: [def.tag],
    security: security(def.auth),
    ...(params.length > 0 ? { parameters: params } : { parameters: [] }),
    ...(def.body
      ? { requestBody: { required: def.bodyOptional !== true, content: { 'application/json': { schema: strictRoot(jsonSchema(def.body, 'input')) } } } }
      : {}),
    responses,
  }
}

const errorSchema: Json = {
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', enum: [...API_ERROR_CODES], description: 'Tipo do erro, que também define o status HTTP.' },
        reason: {
          type: 'string',
          enum: [...DOMAIN_REASONS, ...API_REASONS].sort(),
          description: 'Motivo estável dentro do tipo, para o app decidir o que mostrar.',
        },
        message: { type: 'string', description: 'Texto em português para mostrar à pessoa.' },
        fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Campo enviado para a mensagem do problema nele.' },
        details: { type: 'object', additionalProperties: true, description: 'Dados extras do erro (por exemplo, os próximos horários livres em `nearest`).' },
      },
    },
  },
}

function errorComponents(): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const { name, description } of Object.values(ERROR_RESPONSES)) {
    out[name] = {
      description,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
      ...(name === 'TooManyRequests'
        ? { headers: { 'Retry-After': { description: 'Segundos até poder tentar de novo.', schema: { type: 'integer' } } } }
        : {}),
    }
  }
  return out
}

function build(serverUrl: string): OpenApiDocument {
  const definitions = [...routeDefinitions()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  const paths: Record<string, Record<string, Json>> = {}
  const tags: string[] = []
  for (const def of definitions) {
    paths[def.path] = { ...paths[def.path], [def.method.toLowerCase()]: operation(def) }
    if (!tags.includes(def.tag)) tags.push(def.tag)
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'API do AgendaFlui',
      version: '1.0.0',
      description: [
        'API do aplicativo (clientes e equipe) de uma conta do AgendaFlui.',
        'Toda rota, menos a de saúde e este documento, exige a chave do app no cabeçalho X-App-Key.',
        `As rotas de cliente e de equipe também exigem Authorization: Bearer com ${TOKEN_KINDS}.`,
        'Instantes saem em ISO 8601 UTC (com Z) e vêm sempre com os rótulos locais da conta prontos: o app não faz conta de fuso.',
        'Todo erro tem o formato { "error": { "code", "reason?", "message", "fields?", "details?" } }.',
      ].join(' '),
    },
    servers: [{ url: serverUrl, description: 'API do aplicativo' }],
    tags: tags.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        AppKey: { type: 'apiKey', in: 'header', name: 'X-App-Key', description: 'Chave do aplicativo, criada pelo suporte para a conta.' },
        Bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token de acesso curto, obtido em /v1/auth/customer/login ou /v1/auth/staff/login e renovado pelo refresh.' },
      },
      schemas: { ErrorResponse: errorSchema },
      responses: errorComponents(),
    },
  }
}

let cached: { url: string; document: OpenApiDocument } | null = null

/** O documento OpenAPI 3.1 de todas as rotas do manifesto, com o servidor montado a partir de `API_HOST`. Guardado por servidor. */
export function buildOpenApi(): OpenApiDocument {
  const url = areaLink('api', '/').replace(/\/$/, '')
  if (cached?.url !== url) cached = { url, document: build(url) }
  return cached.document
}
