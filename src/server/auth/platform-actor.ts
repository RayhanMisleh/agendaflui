import type { Prisma } from '@/server/db/generated/client'
import { DomainError } from '@/server/domain/errors'
import type { Actor } from './actor'

export type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NEGADO = 'Você não tem permissão para fazer isso.'

/** Confere que o ator é um admin da plataforma (`forbidden` senão). Não olha o banco: use `requireActiveAdmin` para escrever. */
export function assertPlatformAdmin(actor: PlatformAdminActor): void {
  if (actor?.kind !== 'platform_admin' || typeof actor.adminId !== 'string') throw new DomainError('forbidden', NEGADO)
}

/**
 * Confere o ator e relê o admin no banco, dentro da transação da escrita: admin que não existe mais ou foi desativado
 * (o objeto do ator pode ser de antes) não escreve nada. Devolve o admin lido.
 */
export async function requireActiveAdmin(
  tx: Pick<Prisma.TransactionClient, 'platformAdmin'>,
  actor: PlatformAdminActor,
): Promise<{ id: string; name: string }> {
  assertPlatformAdmin(actor)
  const admin = UUID.test(actor.adminId)
    ? await tx.platformAdmin.findUnique({ where: { id: actor.adminId }, select: { id: true, name: true, active: true } })
    : null
  if (!admin || !admin.active) throw new DomainError('forbidden', NEGADO)
  return { id: admin.id, name: admin.name }
}
