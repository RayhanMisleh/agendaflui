import 'server-only'
import { prisma } from '@/server/db/client'
import { addMinutes } from '@/server/time'
import { AuthError, type Actor } from './actor'
import { fakePasswordHash, verifyPassword } from './password'
import { checkLoginLimit, clearLoginLimit } from './login-limit'
import { generateToken, hashToken } from './tokens'

const SESSAO_MINUTOS = 12 * 60

export async function loginPlatformAdmin(i: {
  email: string
  password: string
  ip?: string
  userAgent?: string
  /** Token da sessão que o navegador já tem no cookie: é revogado no login novo. */
  previousToken?: string
}): Promise<{ token: string; expiresAt: Date }> {
  const email = i.email.trim().toLowerCase()
  const now = new Date()
  await checkLoginLimit('dev', email, i.ip, now)

  const admin = await prisma.platformAdmin.findUnique({ where: { email } })
  const ok = await verifyPassword(admin ? admin.passwordHash : await fakePasswordHash, i.password)
  if (!admin || !ok) throw new AuthError('invalid_credentials')
  if (!admin.active) throw new AuthError('account_inactive')

  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, SESSAO_MINUTOS)
  await prisma.$transaction(async (tx) => {
    // Condicional ao hash conferido: troca de senha no meio do caminho não deixa sessão para a senha antiga.
    const gravado = await tx.platformAdmin.updateMany({ where: { id: admin.id, passwordHash: admin.passwordHash }, data: { lastLoginAt: now } })
    if (gravado.count !== 1) throw new AuthError('invalid_credentials')
    await tx.platformSession.create({ data: { adminId: admin.id, tokenHash: hash, expiresAt, ip: i.ip, userAgent: i.userAgent } })
    if (i.previousToken) {
      await tx.platformSession.updateMany({ where: { tokenHash: hashToken(i.previousToken), revokedAt: null }, data: { revokedAt: now } })
    }
  })
  await clearLoginLimit('dev', email, i.ip)
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
