import type { TenantContext } from '@/server/auth/actor'
import { roleLabel } from '@/server/auth/role-labels'
import { authorize } from '@/server/domain/errors'
import { getTermLabels } from '@/server/domain/settings/business-profile'
import type { Terms } from '@/server/domain/settings/terms'
import type { Modules } from '@/shared/modules'
import { getModules } from '../modules'

export type { Modules }

export type PainelContext = {
  terms: Terms
  modules: Modules
  /** Papel da pessoa em português, com o termo da conta para o profissional ("Tosador"); "Suporte" para o admin. */
  roleLabel: string
  userName: string
}

/**
 * O que toda tela do painel do negócio precisa saber da conta e de quem está nela, calculado num lugar só: termos,
 * módulos, papel em português e nome. Qualquer membro da equipe (e o suporte) lê; cliente do app e visitante, não.
 */
export async function getPainelContext(ctx: TenantContext): Promise<PainelContext> {
  authorize(ctx, 'view_dashboard')
  const terms = await getTermLabels(ctx)
  const modules = await getModules(ctx.db, ctx.businessId)
  const actor = ctx.actor
  if (actor.kind === 'member') return { terms, modules, roleLabel: roleLabel(actor.role, terms.professionalSingular), userName: actor.name }
  return { terms, modules, roleLabel: 'Suporte', userName: actor.kind === 'impersonator' ? actor.name : '' }
}
