import type { TenantContext } from '@/server/auth/actor'
import { NotificationKind } from '@/server/db/generated/enums'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'

export type ChannelToggle = { email: boolean; push: boolean }
export type NotificationSettings = Record<NotificationKind, ChannelToggle>

const MAX_ATTEMPTS = 5
const KINDS: readonly NotificationKind[] = Object.values(NotificationKind)

function allOn(): NotificationSettings {
  return Object.fromEntries(KINDS.map((kind) => [kind, { email: true, push: true }])) as NotificationSettings
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = allOn()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Mescla o JSON da conta com os padrões. Chaves, tipos e valores que não fazem sentido são ignorados; nunca lança. */
export function resolveNotificationSettings(raw: unknown): NotificationSettings {
  const result = allOn()
  if (!isRecord(raw)) return result
  for (const kind of KINDS) {
    const entry = raw[kind]
    if (!isRecord(entry)) continue
    result[kind] = {
      email: typeof entry['email'] === 'boolean' ? entry['email'] : true,
      push: typeof entry['push'] === 'boolean' ? entry['push'] : true,
    }
  }
  return result
}

const toggleSchema = z.strictObject({ email: z.boolean(), push: z.boolean() }).partial()
const patchSchema = z
  .strictObject(Object.fromEntries(KINDS.map((kind) => [kind, toggleSchema])) as Record<NotificationKind, typeof toggleSchema>)
  .partial()

export async function getNotificationSettings(
  ctx: TenantContext,
  db: TenantClient | TenantTx = ctx.db,
): Promise<NotificationSettings> {
  const settings = orNotFound(
    await db.businessSettings.findUnique({ where: { businessId: ctx.businessId }, select: { notifications: true } }),
    'Configurações da conta',
  )
  return resolveNotificationSettings(settings.notifications)
}

export async function updateNotificationSettings(
  ctx: TenantContext,
  patch: Partial<Record<NotificationKind, Partial<ChannelToggle>>>,
  /** Conferência extra que roda primeiro dentro da transação da escrita (o painel dev relê o admin ativo aqui). */
  inTransaction?: () => Promise<unknown>,
): Promise<NotificationSettings> {
  authorize(ctx, 'manage_settings')
  const input = parse(patchSchema, patch)
  return ctx.db.$transaction(async (tx) => {
    await inTransaction?.()
    // Lê e grava só se o JSON ainda for o lido (comparação no próprio UPDATE): se outra alteração passou
    // na frente, relê e tenta de novo, em vez de sobrescrevê-la.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const stored = orNotFound(
        await tx.businessSettings.findUnique({ where: { businessId: ctx.businessId }, select: { notifications: true } }),
        'Configurações da conta',
      )
      const current = resolveNotificationSettings(stored.notifications)
      const next: NotificationSettings = { ...current }
      const changed: NotificationKind[] = []
      for (const kind of KINDS) {
        const wanted = input[kind]
        if (!wanted) continue
        const merged: ChannelToggle = {
          email: wanted.email ?? current[kind].email,
          push: wanted.push ?? current[kind].push,
        }
        next[kind] = merged
        if (merged.email !== current[kind].email || merged.push !== current[kind].push) changed.push(kind)
      }
      if (changed.length === 0) return current
      const { count } = await tx.businessSettings.updateMany({
        where: { businessId: ctx.businessId, notifications: { equals: stored.notifications ?? {} } },
        data: { notifications: next },
      })
      if (count === 0) continue
      await audit(
        ctx,
        {
          action: 'notification_settings.updated',
          targetType: 'BusinessSettings',
          targetId: ctx.businessId,
          metadata: { kinds: changed },
        },
        tx,
      )
      return next
    }
    throw new DomainError('conflict', 'As configurações mudaram enquanto você salvava. Tente de novo.', { reason: 'changed' })
  })
}
