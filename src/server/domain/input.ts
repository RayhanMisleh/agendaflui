import type { TenantContext } from '@/server/auth/actor'

/** Remove as chaves `undefined` (campo não enviado), mantendo o tipo `Partial<T>` até o Prisma. */
export function definedOnly<T extends Record<string, unknown>>(data: T): Partial<T> {
  const result: Partial<T> = {}
  for (const key in data) {
    if (data[key] !== undefined) result[key] = data[key]
  }
  return result
}

/** O cliente do app tem visão reduzida: só o que está ativo e não arquivado. */
export function isCustomer(ctx: TenantContext): boolean {
  return ctx.actor.kind === 'customer'
}
