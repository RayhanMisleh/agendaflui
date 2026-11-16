import 'server-only'
import { prisma } from '@/server/db/client'
import type { MembershipRole } from '@/server/db/generated/client'
import { addMinutes } from '@/server/time'
import { AuthError, type TenantContext } from './actor'
import { DomainError } from '@/server/domain/errors'
import { createTenantContext } from './context'
import { fakePasswordHash, verifyPassword } from './password'
import { checkLoginLimit, clearLoginLimit } from './login-limit'
import { generateToken, hashToken } from './tokens'

const SESSAO_MINUTOS = 30 * 24 * 60

export type MemberSession = {
  user: { id: string; name: string; email: string }
  memberships: { businessId: string; businessName: string; slug: string; role: MembershipRole }[]
  activeBusinessId: string | null
}

async function listMemberships(userId: string): Promise<MemberSession['memberships']> {
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

/** Sessão de usuário válida (não revogada, não vencida). Sessões de impersonação ficam para a Fase 3. */
async function findValidSession(token: string | undefined) {
  if (!token) return null
  const session = await prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
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
}): Promise<{ token: string; expiresAt: Date; session: MemberSession }> {
  const email = i.email.trim().toLowerCase()
  const now = new Date()
  await checkLoginLimit('painel', email, i.ip, now)

  const user = await prisma.user.findUnique({ where: { email } })
  const ok = await verifyPassword(user?.passwordHash ?? (await fakePasswordHash), i.password)
  if (!user || !user.passwordHash || !ok) throw new AuthError('invalid_credentials')

  await clearLoginLimit('painel', email, i.ip)
  const memberships = await listMemberships(user.id)
  const only = memberships.length === 1 ? memberships[0] : undefined
  const activeBusinessId = only ? only.businessId : null

  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, SESSAO_MINUTOS)
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
    prisma.session.create({
      data: { userId: user.id, activeBusinessId, tokenHash: hash, expiresAt, ip: i.ip, userAgent: i.userAgent },
    }),
  ])
  return {
    token,
    expiresAt,
    session: { user: { id: user.id, name: user.name, email: user.email }, memberships, activeBusinessId },
  }
}

export async function getMemberSession(token: string | undefined): Promise<MemberSession | null> {
  const session = await findValidSession(token)
  if (!session) return null
  const memberships = await listMemberships(session.userId)
  const active = memberships.some((m) => m.businessId === session.activeBusinessId)
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    memberships,
    activeBusinessId: active ? session.activeBusinessId : null,
  }
}

export async function selectBusiness(token: string, businessId: string): Promise<void> {
  const session = await findValidSession(token)
  if (!session) throw new AuthError('no_access')
  const memberships = await listMemberships(session.userId)
  if (!memberships.some((m) => m.businessId === businessId)) throw new AuthError('no_access')
  await prisma.session.update({ where: { id: session.id }, data: { activeBusinessId: businessId } })
}

export async function getTenantContext(token: string | undefined): Promise<TenantContext | null> {
  const session = await findValidSession(token)
  if (!session || !session.activeBusinessId) return null
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
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
