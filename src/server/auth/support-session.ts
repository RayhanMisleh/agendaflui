import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { tenantDb } from '@/server/db/tenant'
import { areaLink } from '@/server/area-links'
import { DomainError } from '@/server/domain/errors'
import { auditPlatform } from '@/server/domain/audit'
import { addMinutes } from '@/server/time'
import { AuthError, type TenantContext } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { assertPlatformAdmin, requireActiveAdmin, type PlatformAdminActor } from './platform-actor'
import { hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import { generateToken, hashToken } from './tokens'

/*
 * "Entrar como": o admin da plataforma abre o painel de uma conta com os poderes do dono, sem usar a senha de ninguém.
 * O cookie do painel dev não vale no host do painel; por isso o admin leva um token de passagem (60 s, uso único, só o
 * hash no banco) que a rota do painel troca por uma sessão de suporte. A sessão é uma linha de `sessions` sem usuário,
 * com o admin em `impersonator_admin_id` e a conta em `active_business_id`; vale 60 minutos fixos (sem renovação) e, a
 * cada requisição, o admin (ativo?) e a conta (não arquivada?) são relidos: desativar o admin ou arquivar a conta derruba
 * a sessão na requisição seguinte.
 */

export const HANDOFF_SECONDS = 60
export const SUPPORT_SESSION_MINUTES = 60

export type RequestMeta = { ip?: string; userAgent?: string; previousToken?: string }

export type SupportSession = {
  sessionId: string
  admin: { id: string; name: string }
  business: { id: string; name: string; slug: string; timeZone: string }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Revoga a sessão do painel que o navegador já tinha no cookie (login novo ou troca de suporte). */
export async function revokeCookieSession(
  tx: Pick<Prisma.TransactionClient, 'session'>,
  previousToken: string | undefined,
  now: Date,
): Promise<void> {
  if (!previousToken) return
  await tx.session.updateMany({ where: { tokenHash: hashToken(previousToken), revokedAt: null }, data: { revokedAt: now } })
}

/**
 * Emite o token de passagem e devolve o endereço no host do painel. O token só existe neste retorno e na URL; no banco
 * fica o hash. Grava na auditoria da conta que o suporte começou, com o nome do admin.
 */
export async function startSupport(actor: PlatformAdminActor, businessId: string, now: Date = new Date()): Promise<{ url: string }> {
  assertPlatformAdmin(actor)
  const { token, hash } = generateToken()
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    const conta = UUID.test(businessId) ? await tx.business.findUnique({ where: { id: businessId }, select: { id: true, status: true } }) : null
    if (!conta) throw new DomainError('not_found', 'Conta não encontrada.')
    if (conta.status === 'ARCHIVED') {
      throw new DomainError('business_unavailable', 'Esta conta está arquivada. Reative a conta para entrar como suporte.')
    }
    await tx.supportHandoff.create({
      data: { adminId: actor.adminId, businessId: conta.id, tokenHash: hash, expiresAt: addMinutes(now, HANDOFF_SECONDS / 60) },
    })
    await auditPlatform(tx, actor, { businessId: conta.id, action: 'support.started', targetType: 'business', targetId: conta.id })
  })
  return { url: areaLink('painel', `/suporte/${token}`) }
}

/**
 * Troca o token de passagem por uma sessão de suporte. O token é consumido por um UPDATE condicional (de duas trocas
 * simultâneas, só uma passa) e fica gasto mesmo que o admin ou a conta já não valham. Revoga a sessão que o navegador
 * já tinha no cookie. Qualquer falha devolve `null`, sem dizer o motivo.
 */
export async function redeemSupport(
  token: string,
  meta: RequestMeta,
  now: Date,
): Promise<{ sessionToken: string; expiresAt: Date; slug: string } | null> {
  if (typeof token !== 'string' || token === '') return null
  const tokenHash = hashToken(token)
  return prisma.$transaction(async (tx) => {
    const gasto = await tx.supportHandoff.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (gasto.count !== 1) return null
    const passagem = await tx.supportHandoff.findUniqueOrThrow({ where: { tokenHash }, select: { adminId: true, businessId: true } })
    const [admin, conta] = await Promise.all([
      tx.platformAdmin.findUnique({ where: { id: passagem.adminId }, select: { active: true } }),
      tx.business.findUnique({ where: { id: passagem.businessId }, select: { status: true, slug: true } }),
    ])
    if (!admin?.active || !conta || conta.status === 'ARCHIVED') return null
    const sessao = generateToken()
    const expiresAt = addMinutes(now, SUPPORT_SESSION_MINUTES)
    await tx.session.create({
      data: {
        impersonatorAdminId: passagem.adminId,
        activeBusinessId: passagem.businessId,
        tokenHash: sessao.hash,
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    })
    await revokeCookieSession(tx, meta.previousToken, now)
    return { sessionToken: sessao.token, expiresAt, slug: conta.slug }
  })
}

/**
 * Sessão de suporte válida: não revogada, não vencida, com o admin ainda ativo e a conta ainda existente e não arquivada
 * (relidos a cada chamada). Conta suspensa continua valendo: só o suporte entra nela.
 */
export async function findSupportSession(token: string | undefined, now: Date = new Date()): Promise<SupportSession | null> {
  if (!token) return null
  const s = await prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: now }, userId: null, impersonatorAdminId: { not: null } },
    include: { impersonator: { select: { id: true, name: true, active: true } }, activeBusiness: { select: { id: true, name: true, slug: true, timezone: true, status: true } } },
  })
  if (!s?.impersonator?.active || !s.activeBusiness || s.activeBusiness.status === 'ARCHIVED') return null
  const b = s.activeBusiness
  return {
    sessionId: s.id,
    admin: { id: s.impersonator.id, name: s.impersonator.name },
    business: { id: b.id, name: b.name, slug: b.slug, timeZone: b.timezone },
  }
}

/** Contexto da conta para a sessão de suporte: ator `impersonator` (poderes do dono), conta suspensa incluída. */
export async function getSupportContext(token: string | undefined, now: Date = new Date()): Promise<TenantContext | null> {
  const s = await findSupportSession(token, now)
  if (!s) return null
  return {
    businessId: s.business.id,
    timeZone: s.business.timeZone,
    actor: { kind: 'impersonator', adminId: s.admin.id, name: s.admin.name },
    db: tenantDb(s.business.id),
    clock: () => new Date(),
    request: { ip: null, userAgent: null },
    channel: 'panel',
  }
}

/**
 * Encerra o suporte: apaga a sessão e grava na auditoria da conta, com o nome do admin. A credencial é o próprio token
 * da sessão (vem do cookie do painel), então não há ator a conferir. Token que não é de suporte, ou já apagado: nada.
 */
export async function endSupport(sessionToken: string): Promise<void> {
  if (typeof sessionToken !== 'string' || sessionToken === '') return
  await prisma.$transaction(async (tx) => {
    const s = await tx.session.findFirst({
      where: { tokenHash: hashToken(sessionToken), userId: null, impersonatorAdminId: { not: null } },
      include: { impersonator: { select: { id: true, name: true } } },
    })
    if (!s?.impersonator) return
    const apagada = await tx.session.deleteMany({ where: { id: s.id } })
    if (apagada.count !== 1 || !s.activeBusinessId) return
    await auditPlatform(tx, { kind: 'platform_admin', adminId: s.impersonator.id, name: s.impersonator.name }, {
      businessId: s.activeBusinessId,
      action: 'support.ended',
      targetType: 'business',
      targetId: s.activeBusinessId,
    })
  })
}

/**
 * Conta uma tentativa de trocar token de suporte. Com IP confiável, por IP (IPv6 como /64). Sem IP, por hash do token:
 * cada token tem o seu contador, então token lixo nunca atrapalha o de outra pessoa.
 */
export async function checkSupportLimit(ip: string | undefined, token: string, now: Date): Promise<void> {
  const chave = ip ? limitKey('suporte:ip', ipLimitKeyPart(ip)) : limitKey('suporte:token', hashToken(token))
  const r = await hitRateLimit(chave, LIMITS.authIp, now)
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
}
