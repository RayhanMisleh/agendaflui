import type { TenantContext } from '@/server/auth/actor'
import { roleLabel } from '@/server/auth/role-labels'
import { authorize } from '@/server/domain/errors'
import type { Modules } from '@/shared/modules'
import { getModules } from '../modules'
import { getNicheSettings } from './niche-settings'
import type { NicheKey } from '@/server/niches'

export type PainelContext = {
  modules: Modules
  /** Papel da pessoa em português ("Dono", "Gerente", "Profissional"); "Suporte" para o admin. */
  roleLabel: string
  userName: string
  /** Nicho da conta e a opção de gatos; nulo para conta sem nicho. */
  niche: { key: NicheKey; label: string; servesCats: boolean } | null
}

/**
 * O que toda tela do painel do negócio precisa saber da conta e de quem está nela, calculado num lugar só: módulos, papel em
 * português e nome. Qualquer membro da equipe (e o suporte) lê; cliente e visitante, não.
 */
export async function getPainelContext(ctx: TenantContext): Promise<PainelContext> {
  authorize(ctx, 'view_dashboard')
  const modules = await getModules(ctx.db, ctx.businessId)
  const n = await getNicheSettings(ctx)
  const niche = n.niche === null ? null : { key: n.niche.key, label: n.niche.label, servesCats: n.options.servesCats }
  const actor = ctx.actor
  if (actor.kind === 'member') return { modules, roleLabel: roleLabel(actor.role), userName: actor.name, niche }
  return { modules, roleLabel: 'Suporte', userName: actor.kind === 'impersonator' ? actor.name : '', niche }
}
