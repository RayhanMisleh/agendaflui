import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { uploadUrl } from '@/server/storage/images'
import { lockUserAccess, revokeUserAccess } from './password-reset'

/*
 * Leituras e escritas do próprio usuário (nome, foto, senha) para o domínio de conta, que não usa o cliente cru. Cada
 * escrita recebe um `registrar` que grava a auditoria na MESMA transação.
 */

export type OwnUser = { name: string; email: string; avatarUrl: string | null; passwordHash: string | null }

export async function readOwnUser(userId: string): Promise<OwnUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, passwordHash: true, avatar: { select: { path: true } } },
  })
  return u ? { name: u.name, email: u.email, avatarUrl: uploadUrl(u.avatar), passwordHash: u.passwordHash } : null
}

/** Troca o nome e regrava a busca sem acento (`search_name`). */
export async function writeOwnName(
  userId: string,
  name: string,
  searchName: string,
  registrar: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { name, searchName } })
    await registrar(tx)
  })
}

/**
 * Grava a senha nova, derruba as outras sessões do painel (a do token indicado fica) e os tokens do app de todos os
 * vínculos, na mesma transação. A gravação só vale se a senha ainda é a conferida (`expectedHash`); se mudou no meio
 * do caminho nada é gravado e a função devolve `false`.
 */
export async function writeOwnPassword(i: {
  userId: string
  passwordHash: string
  expectedHash: string
  keepSessionToken: string
  now: Date
  registrar: (tx: Prisma.TransactionClient) => Promise<void>
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, i.userId)
    const gravada = await tx.user.updateMany({ where: { id: i.userId, passwordHash: i.expectedHash }, data: { passwordHash: i.passwordHash } })
    if (gravada.count !== 1) return false
    await tx.userToken.deleteMany({ where: { userId: i.userId, purpose: 'PASSWORD_RESET', usedAt: null } })
    await revokeUserAccess(tx, i.userId, i.now, i.keepSessionToken)
    await i.registrar(tx)
    return true
  })
}
