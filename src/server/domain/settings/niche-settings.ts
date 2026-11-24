import type { TenantContext } from '@/server/auth/actor'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { auditIn } from '@/server/domain/audit'
import { DomainError, authorize, orNotFound, parse, z } from '@/server/domain/errors'
import { writeSettings } from '@/server/domain/settings/versioned'
import { nicheDef, parseNicheOptions, type NicheDef, type PetOptions } from '@/server/niches'

export type NicheSettings = { niche: NicheDef | null; options: PetOptions; version: number }

/** O nicho da conta e as opções dele (inválido ou ausente vira o padrão). Conta sem nicho: `niche` nulo. */
export async function getNicheSettings(ctx: TenantContext, db: TenantClient | TenantTx = ctx.db): Promise<NicheSettings> {
  // Em sequência: dentro de uma transação, o cliente do banco atende uma consulta por vez.
  const conta = await db.business.findUnique({ where: { id: ctx.businessId }, select: { niche: true } })
  const config = await db.businessSettings.findUnique({ where: { businessId: ctx.businessId } })
  const nicho = orNotFound(conta, 'Conta').niche
  const c = orNotFound(config, 'Configurações da conta')
  return { niche: nicheDef(nicho), options: parseNicheOptions(nicho, c.nicheOptions), version: c.version }
}

/** O nicho visto pela vitrine e pela moldura do cliente: loja de pet shop e se atende gatos. */
export async function getStoreNiche(ctx: TenantContext): Promise<{ petNiche: boolean; servesCats: boolean }> {
  const s = await getNicheSettings(ctx)
  return { petNiche: s.niche !== null, servesCats: s.niche !== null && s.options.servesCats }
}

/** Para as funções do nicho pet: conta sem nicho recusa com `niche_unavailable`. */
export async function requirePetNiche(
  ctx: TenantContext,
  db: TenantClient | TenantTx = ctx.db,
): Promise<NicheSettings & { niche: NicheDef }> {
  const s = await getNicheSettings(ctx, db)
  if (s.niche === null) throw new DomainError('conflict', 'Esta loja não atende pets.', { reason: 'niche_unavailable' })
  return { ...s, niche: s.niche }
}

const optionsInput = z.strictObject({ servesCats: z.boolean() })

export async function updateNicheOptions(ctx: TenantContext, i: { servesCats: boolean; version?: number }): Promise<NicheSettings> {
  authorize(ctx, 'manage_settings')
  const { version, ...resto } = i
  const novo = parse(optionsInput, resto)
  return ctx.db.$transaction(async (tx) => {
    const atual = await requirePetNiche(ctx, tx)
    const { row, changed } = await writeSettings(tx, ctx, version, () =>
      novo.servesCats === atual.options.servesCats ? null : { data: { nicheOptions: { servesCats: novo.servesCats } } },
    )
    if (changed) {
      await auditIn(tx, ctx, {
        action: 'settings.niche_options_updated',
        targetType: 'BusinessSettings',
        targetId: ctx.businessId,
        metadata: { servesCats: novo.servesCats },
      })
    }
    return { niche: atual.niche, options: parseNicheOptions(atual.niche.key, row.nicheOptions), version: row.version }
  })
}
