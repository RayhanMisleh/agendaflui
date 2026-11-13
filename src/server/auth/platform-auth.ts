import { prisma } from '@/server/db/client'
import { addMinutes } from '@/server/time'
import { AuthError, type Actor } from './actor'
import { hashPassword, verifyPassword } from './password'
import { createRateLimiter } from './rate-limit'
import { generateToken, hashToken } from './tokens'

const SESSAO_MINUTOS = 12 * 60
let limiter = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 })

export function resetLoginLimiter(): void {
  limiter = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 })
}

// Hash fixo para gastar o mesmo tempo quando o e-mail não existe.
const hashFalso = hashPassword('senha-falsa-para-igualar-o-tempo')

export async function loginPlatformAdmin(i: {
  email: string
  password: string
  ip?: string
  userAgent?: string
}): Promise<{ token: string; expiresAt: Date }> {
  const email = i.email.trim().toLowerCase()
  if (!limiter.check(email).allowed) throw new AuthError('rate_limited')

  const admin = await prisma.platformAdmin.findUnique({ where: { email } })
  const ok = await verifyPassword(admin ? admin.passwordHash : await hashFalso, i.password)
  if (!admin || !ok) throw new AuthError('invalid_credentials')
  if (!admin.active) throw new AuthError('account_inactive')

  limiter.reset(email)
  const now = new Date()
  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, SESSAO_MINUTOS)
  await prisma.$transaction([
    prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: now } }),
    prisma.platformSession.create({
      data: { adminId: admin.id, tokenHash: hash, expiresAt, ip: i.ip, userAgent: i.userAgent },
    }),
  ])
  return { token, expiresAt }
}

export async function getPlatformActor(
  token: string | undefined,
): Promise<Extract<Actor, { kind: 'platform_admin' }> | null> {
  if (!token) return null
  const session = await prisma.platformSession.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { admin: true },
  })
  if (!session || !session.admin.active) return null
  return { kind: 'platform_admin', adminId: session.admin.id, name: session.admin.name }
}

export async function logoutPlatform(token: string): Promise<void> {
  await prisma.platformSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
