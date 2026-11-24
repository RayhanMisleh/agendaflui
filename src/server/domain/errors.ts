import { z } from 'zod'
import type { TenantContext } from '@/server/auth/actor'
import { can, type Capability } from '@/server/auth/capabilities'

// Mensagens padrão do Zod em português, para todo esquema validado por `parse`.
// Os esquemas de domínio importam `z` daqui, não de 'zod'.
z.config(z.locales.pt())
export { z }

/** Motivos estáveis de erro (`DomainError.reason`), em ordem alfabética. Acrescente o seu aqui ao criar um. */
export const DOMAIN_REASONS = [
  'already_started',
  'blocked',
  'busy',
  'calendar_wrong_google',
  'changed',
  'club_only',
  'customer_email_taken',
  'customer_gone',
  'customer_inactive',
  'email_taken',
  'has_future_appointments',
  'idempotency_key_reused',
  'insufficient_points',
  'invalid_code',
  'invalid_quote',
  'invalid_status',
  'invalid_transition',
  'member_of_other_business',
  'membership_taken',
  'needs_password',
  'not_failed',
  'not_today',
  'out_of_stock',
  'payment_unavailable',
  'pickup_unavailable',
  'quote_expired',
  'shipping_unavailable',
  'slot_taken',
  'slot_unavailable',
  'stale_version',
  'too_early',
  'too_late',
  'too_many_open_orders',
  'wrong_password',
] as const
export type DomainReason = (typeof DOMAIN_REASONS)[number]

/**
 * Motivos (`reason`) que só a camada da API produz: conta, token, origem, corpo e entrada da equipe. Lista única,
 * usada pelo código (`ApiAuthError` e o mapeamento de erros) e pelo documento OpenAPI; não repete os de `DOMAIN_REASONS`.
 */
export const API_REASONS = [
  'account_inactive',
  'body_too_large',
  'business_unavailable',
  'invalid_credentials',
  'invalid_refresh_token',
  'no_access',
  'origin_not_allowed',
  'session_invalid',
  'unknown_business',
  'wrong_token_kind',
] as const
export type ApiReason = (typeof API_REASONS)[number]

export type DomainErrorCode =
  | 'validation'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'business_unavailable'
  | 'module_disabled'

export class DomainError extends Error {
  code: DomainErrorCode
  /** Subcódigo estável, por exemplo `slot_taken`. */
  reason?: DomainReason
  /** Campo → mensagem. */
  fields?: Record<string, string>
  details?: Record<string, unknown>

  constructor(
    code: DomainErrorCode,
    message: string,
    extra?: { reason?: DomainReason; fields?: Record<string, string>; details?: Record<string, unknown> },
  ) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    if (extra?.reason !== undefined) this.reason = extra.reason
    if (extra?.fields !== undefined) this.fields = extra.fields
    if (extra?.details !== undefined) this.details = extra.details
  }
}

export function authorize(ctx: TenantContext, capability: Capability): void {
  if (!can(ctx.actor, capability)) {
    throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
  }
}

/**
 * Campo → mensagem de um erro do Zod: o caminho com pontos (`itens.0.qtd`; `_` para a raiz), com a primeira
 * mensagem de cada caminho. `perUnknownKey` faz cada chave desconhecida de um objeto estrito virar um campo
 * com o próprio nome (o padrão a agrupa na raiz do objeto, com a mensagem do Zod).
 */
export function zodFields(error: z.ZodError, opts: { perUnknownKey?: boolean } = {}): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    if (opts.perUnknownKey && issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const path = [...issue.path, key].map(String).join('.')
        if (!(path in fields)) fields[path] = 'Campo não reconhecido. Remova-o da requisição.'
      }
      continue
    }
    const path = issue.path.map(String).join('.') || '_'
    if (!(path in fields)) fields[path] = issue.message
  }
  return fields
}

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new DomainError('validation', 'Confira os campos informados e tente de novo.', { fields: zodFields(result.error) })
}

export function orNotFound<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new DomainError('not_found', `${what} não encontrado.`)
  return value
}

/** Erro P2025 do Prisma: registro a alterar ou excluir não existe. */
/** Violação de índice único do Prisma (P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002'
}

export function isRecordNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2025'
}
