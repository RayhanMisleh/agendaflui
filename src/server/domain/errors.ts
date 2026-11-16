import type { z } from 'zod'
import type { TenantContext } from '@/server/auth/actor'
import { can, type Capability } from '@/server/auth/capabilities'

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
  reason?: string
  /** Campo → mensagem. */
  fields?: Record<string, string>
  details?: Record<string, unknown>

  constructor(
    code: DomainErrorCode,
    message: string,
    extra?: { reason?: string; fields?: Record<string, string>; details?: Record<string, unknown> },
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

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.')
    if (!(path in fields)) fields[path] = issue.message
  }
  throw new DomainError('validation', 'Confira os campos informados e tente de novo.', { fields })
}

export function orNotFound<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new DomainError('not_found', `${what} não encontrado.`)
  return value
}

/** Erro P2025 do Prisma: registro a alterar ou excluir não existe. */
export function isRecordNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2025'
}
