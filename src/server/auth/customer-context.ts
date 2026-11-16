import 'server-only'
import { prisma } from '@/server/db/client'
import type { RequestInfo, TenantContext } from './actor'
import { createTenantContext, isUuid, sessionInvalid } from './context'

/**
 * Contexto de um cliente que chegou pelo app. O cliente é relido do banco a cada requisição: se não existe,
 * é de outra conta, está arquivado ou foi anonimizado, a sessão deixa de valer (`ApiAuthError` 401 `session_invalid`).
 */
export async function createCustomerContext(i: {
  businessId: string
  customerId: string
  request: RequestInfo
  clock?: () => Date
}): Promise<TenantContext> {
  if (!isUuid(i.businessId) || !isUuid(i.customerId)) throw sessionInvalid()
  const customer = await prisma.customer.findFirst({
    where: { id: i.customerId, businessId: i.businessId, archivedAt: null, anonymizedAt: null },
    select: { id: true, name: true },
  })
  if (!customer) throw sessionInvalid()
  return createTenantContext({
    businessId: i.businessId,
    actor: { kind: 'customer', customerId: customer.id, name: customer.name },
    channel: 'app',
    request: i.request,
    ...(i.clock ? { clock: i.clock } : {}),
  })
}
