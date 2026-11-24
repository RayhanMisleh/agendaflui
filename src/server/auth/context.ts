import 'server-only'
import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import type { Actor, Channel, RequestInfo, TenantContext } from './actor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: string): boolean => UUID.test(v)

/**
 * Contexto de conta para o admin da plataforma ajustar a conta pelo painel dev. Diferente do contexto comum, aceita conta
 * suspensa ou arquivada (o admin cuida delas); só `not_found` se a conta não existe. O ator é conferido aqui: quem não é
 * admin da plataforma recebe `forbidden`.
 */
export async function createPlatformAdminContext(i: {
  businessId: string
  actor: Extract<Actor, { kind: 'platform_admin' }>
  clock?: () => Date
  request?: RequestInfo
}): Promise<TenantContext> {
  if (i.actor?.kind !== 'platform_admin') throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
  if (!isUuid(i.businessId)) throw new DomainError('not_found', 'Conta não encontrada.')
  const business = await prisma.business.findUnique({ where: { id: i.businessId }, select: { id: true, timezone: true } })
  if (!business) throw new DomainError('not_found', 'Conta não encontrada.')
  return {
    businessId: business.id,
    timeZone: business.timezone,
    actor: i.actor,
    db: tenantDb(business.id),
    clock: i.clock ?? (() => new Date()),
    request: i.request ?? { ip: null, userAgent: null },
    channel: 'panel',
  }
}

/**
 * Contexto do próprio sistema para tarefas internas que não esperam a conta voltar a ficar ativa: o pagamento já feito
 * (webhook do Mercado Pago) e a varredura de pedidos vencidos valem com a conta suspensa ou arquivada. Só `not_found` se a conta
 * não existe. Quem chama já decidiu o que fazer (não há ator humano); o domínio confere o resto.
 */
export async function createSystemContext(businessId: string, clock?: () => Date): Promise<TenantContext> {
  if (!isUuid(businessId)) throw new DomainError('not_found', 'Conta não encontrada.')
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, timezone: true } })
  if (!business) throw new DomainError('not_found', 'Conta não encontrada.')
  return {
    businessId: business.id,
    timeZone: business.timezone,
    actor: { kind: 'system' },
    db: tenantDb(business.id),
    clock: clock ?? (() => new Date()),
    request: { ip: null, userAgent: null },
    channel: 'system',
  }
}

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
