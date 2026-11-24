import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { DomainError, parse, z } from '@/server/domain/errors'
import { addMinutes } from '@/server/time'
import { AuthError } from './actor'
import { ipLimitKeyPart } from './client-ip'
import { hashPassword, passwordSchema } from './password'
import { lockUserAccess, revokeUserAccess } from './password-reset'
import { activatePerson, personState } from './person'
import { openSession } from './session'
import type { RequestMeta } from './support-session'
import { hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import { generateToken, hashToken } from './tokens'

export type PlatformTx = Prisma.TransactionClient

export const INVITE_TTL_DAYS = 7

/** Mesma frase para convite inexistente, vencido ou já usado: a tela não revela qual dos casos aconteceu. */
export const INVITE_INVALID_MESSAGE =
  'Este convite não vale mais. Peça um novo convite a quem cadastrou você ou entre em contato com o suporte.'

const invalido = (): DomainError => new DomainError('not_found', INVITE_INVALID_MESSAGE)

/**
 * Emite o convite de acesso da pessoa (token opaco de 32 bytes; no banco só o hash). Só vale para conta pendente (sem senha
 * e sem Google). Troca qualquer convite anterior ainda não usado. O token em texto só existe neste retorno, para ir no e-mail.
 */
export async function issueInvite(tx: PlatformTx, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const pessoa = await tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true, googleSub: true } })
  if (!pessoa) throw new DomainError('not_found', 'Usuário não encontrado.')
  if (personState(pessoa) !== 'pending') {
    throw new DomainError('conflict', 'Esta pessoa já tem como entrar. Convite só vale para quem ainda não definiu a senha nem usou o Google.')
  }
  await tx.userToken.deleteMany({ where: { userId, purpose: 'INVITE', usedAt: null } })
  const { token, hash } = generateToken()
  const expiresAt = addMinutes(now, INVITE_TTL_DAYS * 24 * 60)
  await tx.userToken.create({ data: { userId, purpose: 'INVITE', tokenHash: hash, expiresAt } })
  return { token, expiresAt }
}

export type InviteView = { userId: string; userName: string; email: string; businessName: string | null }

/** Quem recebeu o convite (e a conta do vínculo ativo mais recente), ou `null` se o token não existe, venceu ou já foi usado. */
export async function readInvite(token: string, now: Date): Promise<InviteView | null> {
  if (token === '') return null
  const linha = await prisma.userToken.findFirst({
    where: { tokenHash: hashToken(token), purpose: 'INVITE', usedAt: null, expiresAt: { gt: now } },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          memberships: { where: { active: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { business: { select: { name: true } } } },
        },
      },
    },
  })
  if (!linha) return null
  return {
    userId: linha.user.id,
    userName: linha.user.name,
    email: linha.user.email,
    businessName: linha.user.memberships[0]?.business.name ?? null,
  }
}

const senhaSchema = z.object({ password: passwordSchema })

/**
 * Cria a senha com o convite e abre a sessão. Trava o acesso da pessoa na ordem única, consome o token por um UPDATE
 * condicional (de duas aceitações simultâneas, só uma passa), ativa a conta pendente (senha, e-mail verificado, todos os
 * convites consumidos), revoga as sessões antigas e abre a nova. Convite que não vale (ou de quem já ficou ativa): `not_found`
 * com a mesma frase em todos os casos.
 */
export async function acceptInvite(
  i: { token: string; password: string },
  meta: RequestMeta,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const { password } = parse(senhaSchema, { password: i.password })
  const convite = await readInvite(i.token, now)
  if (convite === null) throw invalido()
  const passwordHash = await hashPassword(password)
  const tokenHash = hashToken(i.token)
  const aberta = await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, convite.userId)
    const usado = await tx.userToken.updateMany({
      where: { tokenHash, purpose: 'INVITE', usedAt: null, expiresAt: { gt: now }, userId: convite.userId },
      data: { usedAt: now },
    })
    if (usado.count !== 1) throw invalido()
    // Convite só ativa conta pendente: quem já tem como entrar não perde a senha nem o Google por um convite antigo (o token fica consumido).
    if (!(await activatePerson(tx, convite.userId, { passwordHash }, now))) return null
    await revokeUserAccess(tx, convite.userId, now)
    return openSession(tx, {
      userId: convite.userId,
      now,
      ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
      ...(meta.userAgent !== undefined ? { userAgent: meta.userAgent } : {}),
      ...(meta.previousToken !== undefined ? { previousToken: meta.previousToken } : {}),
    })
  })
  if (!aberta) throw invalido()
  return aberta
}

/**
 * Conta uma tentativa de definir senha. Com IP confiável, por IP (IPv6 como /64). Sem IP (proxy não configurado), por
 * token: cada token tem o seu contador, então token lixo nunca atrapalha o convite de outra pessoa.
 */
export async function checkInviteLimit(ip: string | undefined, token: string, now: Date): Promise<void> {
  const chave = ip ? limitKey('convite:ip', ipLimitKeyPart(ip)) : limitKey('convite:token', hashToken(token))
  const r = await hitRateLimit(chave, LIMITS.authIp, now)
  if (!r.allowed) throw new AuthError('rate_limited', r.retryAfterSec)
}
