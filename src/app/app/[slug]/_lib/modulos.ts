import type { CustomerVisit } from '@/server/auth/customer-access'
import { getModules } from '@/server/domain/modules'

/** Os módulos ligados da loja (menu "Mais", Prêmios, Loja). */
export function modulosDaLoja(visit: CustomerVisit) {
  return getModules(visit.ctx.db, visit.ctx.businessId)
}
