import 'server-only'
import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import type { Actor, Channel, RequestInfo, TenantContext } from './actor'

/** Monta o contexto da conta: lê a conta (fuso e situação) e cria o cliente por conta uma vez. */
export async function createTenantContext(i: {
  businessId: string
  actor: Actor
  clock?: () => Date
  request?: RequestInfo
  channel?: Channel
}): Promise<TenantContext> {
  const business = await prisma.business.findUnique({
    where: { id: i.businessId },
    select: { id: true, timezone: true, status: true },
  })
  if (!business) throw new DomainError('not_found', 'Conta não encontrada.')
  if (business.status !== 'ACTIVE') {
    throw new DomainError('business_unavailable', 'Esta conta não está disponível agora. Fale com o suporte.')
  }
  return {
    businessId: business.id,
    timeZone: business.timezone,
    actor: i.actor,
    db: tenantDb(business.id),
    clock: i.clock ?? (() => new Date()),
    request: i.request ?? { ip: null, userAgent: null },
    channel: i.channel ?? 'panel',
  }
}
