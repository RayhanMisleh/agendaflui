import 'server-only'
import { prisma } from '@/server/db/client'
import type { MembershipRole } from '@/server/db/generated/client'
import { addMinutes } from '@/server/time'
import { AuthError, type TenantContext } from './actor'
import { DomainError } from '@/server/domain/errors'
import { createTenantContext } from './context'
import { fakePasswordHash, verifyPassword } from './password'
import { checkLoginLimit, clearLoginLimit } from './login-limit'
import { endSupportByToken, findSupportSession, getSupportContext, revokeCookieSession } from './support-session'
import { generateToken, hashToken } from './tokens'

const SESSAO_MINUTOS = 30 * 24 * 60

export type MemberSession =
  | {
      kind: 'member'
      user: { id: string; name: string; email: string }
      memberships: { businessId: string; businessName: string; slug: string; role: MembershipRole }[]
      activeBusinessId: string | null
    }
  /** Admin da plataforma "entrando como": não é usuário, não tem vínculos; a conta aberta é sempre a da sessão. */
  | { kind: 'support'; admin: { id: string; name: string }; activeBusinessId: string; businessName: string }

export type MemberUserSession = Extract<MemberSession, { kind: 'member' }>

async function listMemberships(userId: string): Promise<MemberUserSession['memberships']> {
  const rows = await prisma.membership.findMany({
    where: { userId, active: true, business: { status: 'ACTIVE' } },
    include: { business: true },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((m) => ({
    businessId: m.businessId,
    businessName: m.business.name,
    slug: m.business.slug,
    role: m.role,
  }))
}

/** Sessão de usuário válida (não revogada, não vencida). A sessão de suporte (sem usuário) é lida por `support-session`. */
async function findValidSession(token: string | undefined, now: Date) {
  if (!token) return null
  const session = await prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: now } },
    include: { user: true },
  })
  if (!session || !session.userId || !session.user) return null
  return { ...session, userId: session.userId, user: session.user }
}

export async function loginUser(i: {
  email: string
  password: string
  ip?: string
  userAgent?: string
  /** Token da sessão que o navegador já tem no cookie: é revogado no login novo. */
  previousToken?: string
}): Promise<{ token: string; expiresAt: Date; session: MemberUserSession }> {
  const email = i.email.trim().toLowerCase()
  const now = new Date()
  await checkLoginLimit('painel', email, i.ip, now)

  const user = await prisma.user.findUnique({ where: { email } })
  const ok = await verifyPassword(user?.passwordHash ?? (await fakePasswordHash), i.password)
  if (!user || !user.passwordHash || !ok) throw new AuthError('invalid_credentials')

  const memberships = await listMemberships(user.id)
  const only = memberships.length === 1 ? memberships[0] : undefined
  const activeBusinessId = only ? only.businessId : null

  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, SESSAO_MINUTOS)
  await prisma.$transaction(async (tx) => {
    // Condicional ao hash conferido: quem trocou ou redefiniu a senha entre a conferência e aqui (a troca revoga as sessões
    // sob a trava do usuário) não deixa sessão nova para quem entrou com a senha antiga. A linha do usuário é a trava.
    const gravado = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { lastLoginAt: now } })
    if (gravado.count !== 1) throw new AuthError('invalid_credentials')
    await tx.session.create({
      data: { userId: user.id, activeBusinessId, tokenHash: hash, expiresAt, ip: i.ip, userAgent: i.userAgent },
    })
    await revokeCookieSession(tx, i.previousToken, now)
  })
  await clearLoginLimit('painel', email, i.ip)
  return {
    token,
    expiresAt,
    session: { kind: 'member', user: { id: user.id, name: user.name, email: user.email }, memberships, activeBusinessId },
  }
}

export async function getMemberSession(token: string | undefined, now: Date = new Date()): Promise<MemberSession | null> {
  const session = await findValidSession(token, now)
  if (!session) {
    const suporte = await findSupportSession(token, now)
    if (!suporte) return null
    return { kind: 'support', admin: suporte.admin, activeBusinessId: suporte.business.id, businessName: suporte.business.name }
  }
  const memberships = await listMemberships(session.userId)
  const active = memberships.some((m) => m.businessId === session.activeBusinessId)
  return {
    kind: 'member',
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    memberships,
    activeBusinessId: active ? session.activeBusinessId : null,
  }
}

export async function getTenantContext(token: string | undefined, now: Date = new Date()): Promise<TenantContext | null> {
  const session = await findValidSession(token, now)
  if (!session) return getSupportContext(token, now)
  if (!session.activeBusinessId) return null
  // Papel, vínculo e situação da conta são relidos a cada chamada.
  const membership = await prisma.membership.findFirst({
    where: { userId: session.userId, businessId: session.activeBusinessId, active: true, business: { status: 'ACTIVE' } },
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

export async function logoutUser(token: string): Promise<void> {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // Sessão de suporte: o fim vai para a auditoria da conta; sessão de membro: só é revogada.
    if (await endSupportByToken(tx, token, now)) return
    await tx.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now } })
  })
}
