import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { addMinutes } from '@/server/time'
import { AuthError, type TenantContext } from './actor'
import { DomainError } from '@/server/domain/errors'
import { createTenantContext } from './context'
import { fakePasswordHash, verifyPassword } from './password'
import { checkLoginLimit, clearLoginLimit } from './login-limit'
import { endSupportByToken, findSupportSession, getSupportContext, revokeCookieSession } from './support-session'
import { generateToken, hashToken } from './tokens'

/*
 * Sessão única da pessoa: um cookie para todos os papéis, 30 dias, vários aparelhos ao mesmo tempo (entrar num não derruba
 * o outro; trocar a senha derruba todos). O papel NÃO vive na sessão: a equipe é o vínculo ativo da pessoa, relido a cada
 * chamada, e o cliente é o vínculo de cada loja, conferido por quem usa. A sessão só guarda a última loja usada.
 */

export const SESSION_MINUTES = 30 * 24 * 60

export type PersonSession =
  | { kind: 'person'; sessionId: string; user: { id: string; name: string; email: string }; customerBusinessId: string | null }
  /** Admin da plataforma "entrando como": não é pessoa, não tem vínculos; a conta aberta é sempre a da sessão. */
  | { kind: 'support'; admin: { id: string; name: string }; activeBusinessId: string; businessName: string }

/**
 * Abre uma sessão para a pessoa, na transação do chamador: cria a linha, grava `lastLoginAt` e revoga só a sessão que o
 * navegador já tinha no cookie (`previousToken`); as dos outros aparelhos ficam.
 */
export async function openSession(
  tx: Prisma.TransactionClient,
  i: { userId: string; now: Date; ip?: string; userAgent?: string; previousToken?: string; customerBusinessId?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const { token, hash } = generateToken()
  const expiresAt = addMinutes(i.now, SESSION_MINUTES)
  await tx.session.create({
    data: {
      userId: i.userId,
      customerBusinessId: i.customerBusinessId ?? null,
      tokenHash: hash,
      expiresAt,
      ip: i.ip ?? null,
      userAgent: i.userAgent ?? null,
    },
  })
  await tx.user.update({ where: { id: i.userId }, data: { lastLoginAt: i.now } })
  await revokeCookieSession(tx, i.previousToken, i.now)
  return { token, expiresAt }
}

/** Entrada por e-mail e senha. Mesmo erro (`invalid_credentials`) para e-mail inexistente, conta sem senha (pendente ou só Google) e senha errada. */
export async function loginWithPassword(
  i: { email: string; password: string; ip?: string; userAgent?: string; previousToken?: string; customerBusinessId?: string | null },
  now: Date,
): Promise<{ token: string; expiresAt: Date; userId: string }> {
  const email = i.email.trim().toLowerCase()
  await checkLoginLimit('app', email, i.ip, now)

  const user = await prisma.user.findUnique({ where: { email } })
  const ok = await verifyPassword(user?.passwordHash ?? (await fakePasswordHash), i.password)
  if (!user || !user.passwordHash || !ok) throw new AuthError('invalid_credentials')

  const aberta = await prisma.$transaction(async (tx) => {
    // Condicional ao hash conferido: quem trocou ou redefiniu a senha entre a conferência e aqui (a troca revoga as sessões
    // sob a trava da pessoa) não deixa sessão nova para quem entrou com a senha antiga. A linha da pessoa é a trava.
    const gravado = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { lastLoginAt: now } })
    if (gravado.count !== 1) throw new AuthError('invalid_credentials')
    return openSession(tx, {
      userId: user.id,
      now,
      ...(i.ip !== undefined ? { ip: i.ip } : {}),
      ...(i.userAgent !== undefined ? { userAgent: i.userAgent } : {}),
      ...(i.previousToken !== undefined ? { previousToken: i.previousToken } : {}),
      ...(i.customerBusinessId !== undefined ? { customerBusinessId: i.customerBusinessId } : {}),
    })
  })
  await clearLoginLimit('app', email, i.ip)
  return { ...aberta, userId: user.id }
}

/** Sessão de pessoa válida (não revogada, não vencida). A sessão de suporte (sem pessoa) é lida por `support-session`. */
async function findValidSession(token: string | undefined, now: Date) {
  if (!token) return null
  const session = await prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: now } },
    include: { user: true },
  })
  if (!session || !session.userId || !session.user) return null
  return { ...session, userId: session.userId, user: session.user }
}

export async function getPersonSession(token: string | undefined, now: Date = new Date()): Promise<PersonSession | null> {
  const session = await findValidSession(token, now)
  if (!session) {
    const suporte = await findSupportSession(token, now)
    if (!suporte) return null
    return { kind: 'support', admin: suporte.admin, activeBusinessId: suporte.business.id, businessName: suporte.business.name }
  }
  return {
    kind: 'person',
    sessionId: session.id,
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    customerBusinessId: session.customerBusinessId,
  }
}

/**
 * Contexto da loja para a equipe. Suporte: a conta da sessão. Pessoa: o único vínculo ativo numa conta ativa (o índice
 * garante no máximo um), relido a cada chamada: papel, vínculo e situação da conta nunca vêm da sessão. `null` se a pessoa
 * não é da equipe de nenhuma conta ativa.
 */
export async function getStaffContext(token: string | undefined, now: Date = new Date()): Promise<TenantContext | null> {
  const session = await findValidSession(token, now)
  if (!session) return getSupportContext(token, now)
  const membership = await prisma.membership.findFirst({
    where: { userId: session.userId, active: true, business: { status: 'ACTIVE' } },
  })
  if (!membership) return null
  try {
    return await createTenantContext({
      businessId: membership.businessId,
      actor: {
        kind: 'member',
        userId: session.user.id,
        membershipId: membership.id,
        name: session.user.name,
        role: membership.role,
      },
    })
  } catch (e) {
    // A conta pode ter saído do ar entre a leitura do vínculo e a do contexto.
    if (e instanceof DomainError && (e.code === 'business_unavailable' || e.code === 'not_found')) return null
    throw e
  }
}

/** Grava a última loja usada pelo cliente na sessão. Só por ação explícita da pessoa (entrar, cadastrar, usar a conta, trocar de loja). */
export async function setSessionStore(token: string, businessId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null, userId: { not: null } },
    data: { customerBusinessId: businessId },
  })
}

export async function logout(token: string): Promise<void> {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // Sessão de suporte: o fim vai para a auditoria da conta; sessão de pessoa: só é revogada.
    if (await endSupportByToken(tx, token, now)) return
    await tx.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now } })
  })
}
