import 'server-only'
import { notFound } from 'next/navigation'
import type { TenantContext } from '@/server/auth/actor'
import { isModuleOn } from '@/server/domain/modules'
import type { ModuleName } from '@/shared/modules'

/** Páginas de um módulo respondem 404 com o módulo desligado (e o menu já não mostra o destino). */
export async function requirePainelModule(ctx: TenantContext, m: ModuleName): Promise<void> {
  if (!(await isModuleOn(ctx.db, ctx.businessId, m))) notFound()
}
