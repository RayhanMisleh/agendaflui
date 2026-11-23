import 'server-only'
import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import { ApiAuthError } from '@/server/auth/api-auth-error'
import type { Actor, Channel, RequestInfo, TenantContext } from './actor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: string): boolean => UUID.test(v)

/** Token válido, mas a pessoa por trás dele não pode mais entrar. Mesma resposta em todos os casos. */
export const sessionInvalid = (): ApiAuthError =>
  new ApiAuthError('unauthorized', 'session_invalid', 'Sua sessão não é mais válida. Entre de novo.')

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
