import type { TenantContext } from '@/server/auth/actor'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import { MODULE_LABELS, MODULE_NAMES, type ModuleName, type Modules } from '@/shared/modules'

/** Os módulos de uma vez (uma leitura só). Linha ausente = tudo desligado. */
export async function getModules(db: Pick<TenantClient | TenantTx, 'businessModules'>, businessId: string): Promise<Modules> {
  const row = await db.businessModules.findUnique({ where: { businessId } })
  return Object.fromEntries(MODULE_NAMES.map((m) => [m, row?.[m] === true])) as Modules
}

/** O módulo está ligado nesta conta? Linha de módulos ausente = tudo desligado. */
export async function isModuleOn(db: Pick<TenantClient | TenantTx, 'businessModules'>, businessId: string, m: ModuleName): Promise<boolean> {
  return (await getModules(db, businessId))[m]
}

/** Recusa com `module_disabled` quando o módulo está desligado. Com `db`, lê dentro da transação do chamador. */
export async function requireModule(ctx: TenantContext, m: ModuleName, db: TenantClient | TenantTx = ctx.db): Promise<void> {
  if (!(await isModuleOn(db, ctx.businessId, m))) {
    throw new DomainError('module_disabled', `O módulo ${MODULE_LABELS[m]} não está ligado nesta conta.`)
  }
}
