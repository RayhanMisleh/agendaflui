import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { tenantDb } from '@/server/db/tenant'
import { areaLink } from '@/server/area-links'
import { DomainError } from '@/server/domain/errors'
import { auditPlatform } from '@/server/domain/audit'
import { addMinutes, fromEpochMs, toIsoInstant } from '@/server/time'
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

/**
 * Ponto único que encerra uma sessão de suporte viva (por qualquer caminho: Encerrar, Sair, login novo, nova troca de
 * token): apaga a linha e grava `support.ended` na auditoria da conta, com o nome do admin. O DELETE condicional garante
 * uma única linha mesmo com chamadas simultâneas. Sessão que já venceu só é apagada, sem auditoria (vencer não é encerrar).
 * Token que não é de uma sessão de suporte: nada acontece. Devolve se encerrou uma sessão.
 */
export async function endSupportByToken(tx: Pick<Prisma.TransactionClient, 'session' | 'auditLog'>, token: string, now: Date): Promise<boolean> {
  const s = await tx.session.findFirst({
    where: { tokenHash: hashToken(token), userId: null, impersonatorAdminId: { not: null } },
    include: { impersonator: { select: { id: true, name: true } } },
  })
  if (!s?.impersonator) return false
  const apagada = await tx.session.deleteMany({ where: { id: s.id } })
  if (apagada.count !== 1) return false
  if (s.revokedAt !== null || s.expiresAt.getTime() <= now.getTime() || !s.activeBusinessId) return false
  await auditPlatform(tx, { kind: 'platform_admin', adminId: s.impersonator.id, name: s.impersonator.name }, {
    businessId: s.activeBusinessId,
    action: 'support.ended',
    targetType: 'business',
    targetId: s.activeBusinessId,
  })
  return true
}

/** Revoga a sessão do painel que o navegador já tinha no cookie (login novo ou troca de suporte); se era de suporte, grava o fim. */
export async function revokeCookieSession(
  tx: Pick<Prisma.TransactionClient, 'session' | 'auditLog'>,
  previousToken: string | undefined,
  now: Date,
): Promise<void> {
  if (!previousToken) return
  if (await endSupportByToken(tx, previousToken, now)) return
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
    await auditPlatform(tx, actor, { businessId: conta.id, action: 'support.link_issued', targetType: 'business', targetId: conta.id })
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
      tx.platformAdmin.findUnique({ where: { id: passagem.adminId }, select: { active: true, name: true } }),
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
    await auditPlatform(tx, { kind: 'platform_admin', adminId: passagem.adminId, name: admin.name }, {
      businessId: passagem.businessId,
      action: 'support.started',
      targetType: 'business',
      targetId: passagem.businessId,
    })
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
 * Encerra o suporte (botão Encerrar): apaga a sessão e grava o fim na auditoria. A credencial é o próprio token da sessão
 * (vem do cookie do painel), então não há ator a conferir. Token que não é de suporte, ou já apagado: nada.
 */
export async function endSupport(sessionToken: string, now: Date = new Date()): Promise<void> {
  if (typeof sessionToken !== 'string' || sessionToken === '') return
  await prisma.$transaction((tx) => endSupportByToken(tx, sessionToken, now))
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

/** Apaga as passagens de suporte vencidas há mais de 1 dia (usadas ou não). Devolve quantas apagou. */
export async function purgeSupportHandoffs(now: Date): Promise<number> {
  const corte = fromEpochMs(now.getTime() - 24 * 60 * 60 * 1000)
  const r = await prisma.supportHandoff.deleteMany({ where: { expiresAt: { lt: corte } } })
  return r.count
}

/**
 * Apaga as sessões do painel (`sessions`) e do painel dev (`platform_sessions`) vencidas há mais de 1 dia, revogadas ou não.
 * Sessão de suporte que venceu sem `support.ended` nem revogação grava `support.expired` na auditoria da conta, com o nome do
 * admin (cada linha só é apagada uma vez, então a auditoria também sai uma vez). Devolve quantas linhas apagou.
 */
export async function purgeExpiredSessions(now: Date): Promise<number> {
  const corte = fromEpochMs(now.getTime() - 24 * 60 * 60 * 1000)
  return prisma.$transaction(async (tx) => {
    const suporte = await tx.session.findMany({
      where: { expiresAt: { lt: corte }, revokedAt: null, userId: null, impersonatorAdminId: { not: null }, activeBusinessId: { not: null } },
      select: { id: true, expiresAt: true, activeBusinessId: true, impersonator: { select: { id: true, name: true } } },
    })
    let apagadas = 0
    // Cada sessão de suporte é apagada pelo próprio id e só audita quem de fato a apagou: duas instâncias não gravam em dobro.
    for (const s of suporte) {
      const r = await tx.session.deleteMany({ where: { id: s.id } })
      apagadas += r.count
      if (r.count !== 1 || !s.impersonator || !s.activeBusinessId) continue
      await auditPlatform(tx, { kind: 'platform_admin', adminId: s.impersonator.id, name: s.impersonator.name }, {
        businessId: s.activeBusinessId,
        action: 'support.expired',
        targetType: 'business',
        targetId: s.activeBusinessId,
        metadata: { expiresAt: toIsoInstant(s.expiresAt) },
      })
    }
    apagadas += (await tx.session.deleteMany({ where: { expiresAt: { lt: corte } } })).count
    const painel = await tx.platformSession.deleteMany({ where: { expiresAt: { lt: corte } } })
    return apagadas + painel.count
  })
}
