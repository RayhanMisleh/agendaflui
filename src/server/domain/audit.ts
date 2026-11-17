import type { Prisma } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import type { Actor, TenantContext } from '@/server/auth/actor'
import { DomainError } from '@/server/domain/errors'

type Autor = {
  actorType: 'USER' | 'PLATFORM_ADMIN' | 'SYSTEM'
  actorId: string | null
  actorName: string
  onBehalf: boolean
  extra: Prisma.InputJsonObject
}

function autor(actor: Actor): Autor {
  switch (actor.kind) {
    case 'member':
      return { actorType: 'USER', actorId: actor.userId, actorName: actor.name, onBehalf: false, extra: {} }
    case 'impersonator':
      return { actorType: 'PLATFORM_ADMIN', actorId: actor.adminId, actorName: actor.name, onBehalf: true, extra: {} }
    case 'platform_admin':
      return { actorType: 'PLATFORM_ADMIN', actorId: actor.adminId, actorName: actor.name, onBehalf: false, extra: {} }
    case 'customer':
      return {
        actorType: 'SYSTEM',
        actorId: null,
        // O nome real do cliente não vai para a auditoria; o `customerId` em `metadata` identifica quem foi.
        actorName: 'Cliente',
        onBehalf: false,
        extra: { customerId: actor.customerId },
      }
    case 'system':
      return { actorType: 'SYSTEM', actorId: null, actorName: 'Sistema', onBehalf: false, extra: {} }
    case 'guest':
      // O visitante não grava nada; se uma escrita chegou até aqui, a checagem de permissão falhou antes.
      throw new DomainError('forbidden', 'Entre na sua conta para fazer isso.')
  }
}

/** Registra uma ação na auditoria da conta (no cliente por conta o `businessId` é o do contexto; `auditIn` o grava). */
export async function audit(
  ctx: TenantContext,
  entry: { action: string; targetType?: string; targetId?: string; metadata?: Prisma.InputJsonObject },
  db: Pick<TenantClient | TenantTx, 'auditLog'> = ctx.db,
): Promise<void> {
  await auditIn(db, ctx, entry)
}

/**
 * Corpo único da linha de auditoria da conta: `audit` o usa com o cliente por conta, e o domínio de plataforma o usa numa
 * transação do `prisma` cru (a escrita também toca usuários e sessões, que `tenantDb` recusa). O autor sai do ator do
 * contexto: membro, ou admin em suporte (com a marca).
 */
export async function auditIn(
  tx: { auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> } },
  ctx: TenantContext,
  entry: { action: string; targetType?: string; targetId?: string; metadata?: Prisma.InputJsonObject },
): Promise<void> {
  const a = autor(ctx.actor)
  await tx.auditLog.create({
    data: {
      businessId: ctx.businessId,
      actorType: a.actorType,
      actorId: a.actorId,
      actorName: a.actorName,
      onBehalf: a.onBehalf,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: { ...entry.metadata, ...a.extra },
      ip: ctx.request.ip,
    },
  })
}

/**
 * Linha de auditoria de uma ação do admin da plataforma feita fora de um contexto de conta (painel dev), na transação da
 * escrita. O admin é o autor; `businessId` é a conta afetada, ou `null` para o que é só da plataforma.
 */
export async function auditPlatform(
  tx: Pick<Prisma.TransactionClient, 'auditLog'>,
  actor: Extract<Actor, { kind: 'platform_admin' }>,
  entry: { businessId: string | null; action: string; targetType: string; targetId: string; metadata?: Prisma.InputJsonObject },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      businessId: entry.businessId,
      actorType: 'PLATFORM_ADMIN',
      actorId: actor.adminId,
      actorName: actor.name,
      onBehalf: false,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
    },
  })
}
