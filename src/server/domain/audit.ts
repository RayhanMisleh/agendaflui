import type { Prisma } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import type { Actor, TenantContext } from '@/server/auth/actor'

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
        actorName: actor.name,
        onBehalf: false,
        extra: { customerId: actor.customerId },
      }
    case 'system':
      return { actorType: 'SYSTEM', actorId: null, actorName: 'Sistema', onBehalf: false, extra: {} }
  }
}

/** Registra uma ação na auditoria da conta (o `businessId` entra pelo `ctx.db`). */
export async function audit(
  ctx: TenantContext,
  entry: { action: string; targetType?: string; targetId?: string; metadata?: Prisma.InputJsonObject },
  db: Pick<TenantClient | TenantTx, 'auditLog'> = ctx.db,
): Promise<void> {
  const a = autor(ctx.actor)
  await db.auditLog.create({
    data: {
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
