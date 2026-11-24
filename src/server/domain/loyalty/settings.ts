import type { TenantContext } from '@/server/auth/actor'
import { auditIn } from '@/server/domain/audit'
import { authorize, orNotFound, parse, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { writeSettings } from '@/server/domain/settings/versioned'

const schema = z.strictObject({ rankingEnabled: z.boolean('Informe se o ranking fica ligado.') })

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'loyalty')
  authorize(ctx, 'manage_loyalty')
}

export async function getLoyaltySettings(ctx: TenantContext): Promise<{ rankingEnabled: boolean; version: number }> {
  await guard(ctx)
  const row = orNotFound(await ctx.db.businessSettings.findUnique({ where: { businessId: ctx.businessId } }), 'Configurações da conta')
  return { rankingEnabled: row.loyaltyRankingEnabled, version: row.version }
}

/** Liga ou desliga o ranking; a versão lida evita sobrescrever a mudança de outra pessoa (`stale_version`). */
export async function updateLoyaltySettings(
  ctx: TenantContext,
  version: number,
  i: { rankingEnabled: boolean },
): Promise<{ rankingEnabled: boolean; version: number }> {
  await guard(ctx)
  const input = parse(schema, i)
  return ctx.db.$transaction(async (tx) => {
    let before = input.rankingEnabled
    const { row, changed } = await writeSettings(tx, ctx, version, (atual) => {
      before = atual.loyaltyRankingEnabled
      return atual.loyaltyRankingEnabled === input.rankingEnabled ? null : { data: { loyaltyRankingEnabled: input.rankingEnabled } }
    })
    if (changed) {
      await auditIn(tx, ctx, {
        action: 'loyalty.settings_updated',
        targetType: 'business',
        targetId: ctx.businessId,
        metadata: { rankingEnabled: { from: before, to: input.rankingEnabled } },
      })
    }
    return { rankingEnabled: row.loyaltyRankingEnabled, version: row.version }
  })
}
