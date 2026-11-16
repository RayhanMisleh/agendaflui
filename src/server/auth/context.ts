import 'server-only'
import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import { ApiAuthError } from '@/server/domain/platform/api-keys'
import type { Actor, Channel, RequestInfo, TenantContext } from './actor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: string): boolean => UUID.test(v)

/** Token válido, mas a pessoa por trás dele não pode mais entrar. Mesma resposta em todos os casos. */
export const sessionInvalid = (): ApiAuthError =>
  new ApiAuthError('unauthorized', 'session_invalid', 'Sua sessão não é mais válida. Entre de novo.')

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

/**
 * Contexto de um membro da equipe que chegou pelo app (token de acesso). Vínculo e usuário são relidos do banco:
 * o papel nunca vem do token. Vínculo inexistente, de outra conta, de outro usuário ou desativado: `ApiAuthError` 401.
 */
export async function createMemberContext(i: {
  businessId: string
  membershipId: string
  userId: string
  request: RequestInfo
  clock?: () => Date
}): Promise<TenantContext> {
  if (![i.businessId, i.membershipId, i.userId].every(isUuid)) throw sessionInvalid()
  const membership = await prisma.membership.findFirst({
    where: { id: i.membershipId, businessId: i.businessId, userId: i.userId, active: true },
    select: { id: true, userId: true, role: true, user: { select: { name: true } } },
  })
  if (!membership) throw sessionInvalid()
  return createTenantContext({
    businessId: i.businessId,
    actor: { kind: 'member', userId: membership.userId, membershipId: membership.id, name: membership.user.name, role: membership.role },
    channel: 'app',
    request: i.request,
    ...(i.clock ? { clock: i.clock } : {}),
  })
}
