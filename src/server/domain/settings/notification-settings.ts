import type { TenantContext } from '@/server/auth/actor'
import { NotificationKind } from '@/server/db/generated/enums'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { auditIn } from '@/server/domain/audit'
import { authorize, orNotFound, parse, z } from '@/server/domain/errors'
import { writeSettings, type SettingsTx } from '@/server/domain/settings/versioned'

export type ChannelToggle = { email: boolean; push: boolean }
export type NotificationSettings = Record<NotificationKind, ChannelToggle>

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

/** Os avisos com a versão das configurações (a mesma dos termos e das regras), que a gravação com controle de edição exige. */
export async function getNotificationSettingsView(
  ctx: TenantContext,
  db: TenantClient | TenantTx = ctx.db,
): Promise<{ settings: NotificationSettings; version: number }> {
  const row = orNotFound(
    await db.businessSettings.findUnique({ where: { businessId: ctx.businessId }, select: { notifications: true, version: true } }),
    'Configurações da conta',
  )
  return { settings: resolveNotificationSettings(row.notifications), version: row.version }
}

/**
 * Grava os avisos dentro da transação `tx` (a do cliente da conta, ou a do `prisma` cru do painel dev). Único caminho de
 * escrita dos avisos: o dono e o admin passam por aqui. Versão informada: UPDATE condicional (`stale_version`); sem ela,
 * grava e sobe a versão. Sem mudança não grava, não sobe e não audita; a auditoria guarda antes e depois do que mudou.
 */
export async function applyNotificationSettings(
  ctx: TenantContext,
  tx: SettingsTx,
  patch: Partial<Record<NotificationKind, Partial<ChannelToggle>>>,
  version?: number,
): Promise<NotificationSettings> {
  authorize(ctx, 'manage_settings')
  const input = parse(patchSchema, patch)
  let changes: Record<string, { from: ChannelToggle; to: ChannelToggle }> = {}
  const { row } = await writeSettings(tx, ctx, version, (stored) => {
    const current = resolveNotificationSettings(stored.notifications)
    const next: NotificationSettings = { ...current }
    const mudados: Record<string, { from: ChannelToggle; to: ChannelToggle }> = {}
    for (const kind of KINDS) {
      const wanted = input[kind]
      if (!wanted) continue
      const merged: ChannelToggle = {
        email: wanted.email ?? current[kind].email,
        push: wanted.push ?? current[kind].push,
      }
      next[kind] = merged
      if (merged.email !== current[kind].email || merged.push !== current[kind].push) {
        mudados[kind] = { from: current[kind], to: merged }
      }
    }
    changes = mudados
    return Object.keys(mudados).length === 0 ? null : { data: { notifications: next } }
  })
  const kinds = Object.keys(changes)
  if (kinds.length > 0) {
    await auditIn(tx, ctx, {
      action: 'notification_settings.updated',
      targetType: 'BusinessSettings',
      targetId: ctx.businessId,
      metadata: { kinds, changes },
    })
  }
  return resolveNotificationSettings(row.notifications)
}

export async function updateNotificationSettings(
  ctx: TenantContext,
  patch: Partial<Record<NotificationKind, Partial<ChannelToggle>>>,
  version?: number,
): Promise<NotificationSettings> {
  authorize(ctx, 'manage_settings')
  return ctx.db.$transaction((tx) => applyNotificationSettings(ctx, tx, patch, version))
}
