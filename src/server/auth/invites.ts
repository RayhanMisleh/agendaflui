import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { DomainError, parse, z } from '@/server/domain/errors'
import { addMinutes } from '@/server/time'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { hashPassword, passwordSchema } from './password'
import { hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import { generateToken, hashToken } from './tokens'

export type PlatformTx = Prisma.TransactionClient

export const INVITE_TTL_DAYS = 7

/** Mesma frase para convite inexistente, vencido ou já usado: a tela não revela qual dos casos aconteceu. */
export const INVITE_INVALID_MESSAGE =
  'Este convite não vale mais. Peça um novo convite a quem cadastrou você ou entre em contato com o suporte.'

const invalido = (): DomainError => new DomainError('not_found', INVITE_INVALID_MESSAGE)

/**
 * Emite o convite de acesso do usuário (token opaco de 32 bytes; no banco só o hash). Troca qualquer convite anterior
 * ainda não usado. O token em texto só existe neste retorno, para ir no e-mail.
 */
export async function issueInvite(tx: PlatformTx, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  await tx.userToken.deleteMany({ where: { userId, purpose: 'INVITE', usedAt: null } })
  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, INVITE_TTL_DAYS * 24 * 60)
  await tx.userToken.create({ data: { userId, purpose: 'INVITE', tokenHash: hash, expiresAt } })
  return { token, expiresAt }
}

/** Nome e e-mail de quem recebeu o convite, ou `null` se o token não existe, venceu ou já foi usado. */
export async function readInvite(token: string, now: Date): Promise<{ userName: string; email: string } | null> {
  if (token === '') return null
  const linha = await prisma.userToken.findFirst({
    where: { tokenHash: hashToken(token), purpose: 'INVITE', usedAt: null, expiresAt: { gt: now } },
    select: { user: { select: { name: true, email: true } } },
  })
  return linha ? { userName: linha.user.name, email: linha.user.email } : null
}

const senhaSchema = z.object({ password: passwordSchema })

/**
 * Define a senha com o convite. O token é consumido por um UPDATE condicional: de duas aceitações simultâneas, só uma
 * passa. Revoga as sessões antigas do usuário. Convite que não vale: `not_found` com a mesma frase em todos os casos.
 */
export async function acceptInvite(i: { token: string; password: string }, now: Date): Promise<void> {
  const { password } = parse(senhaSchema, { password: i.password })
  if ((await readInvite(i.token, now)) === null) throw invalido()
  const passwordHash = await hashPassword(password)
  const tokenHash = hashToken(i.token)
  await prisma.$transaction(async (tx) => {
    const usado = await tx.userToken.updateMany({
      where: { tokenHash, purpose: 'INVITE', usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (usado.count !== 1) throw invalido()
    const { userId } = await tx.userToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } })
    await tx.user.update({ where: { id: userId }, data: { passwordHash } })
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })
  })
}

/** Conta uma tentativa de definir senha por IP (o IPv6 entra como /64). Sem IP confiável, todas dividem uma chave só. */
export async function checkInviteLimit(ip: string | undefined, now: Date): Promise<void> {
  const chave = ip ? limitKey('convite:ip', ipLimitKeyPart(ip)) : 'convite:sem-ip'
  const r = await hitRateLimit(chave, LIMITS.authIp, now)
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
}
