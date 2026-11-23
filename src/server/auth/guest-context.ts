import 'server-only'
import { tenantDb } from '@/server/db/tenant'
import type { RequestInfo, TenantContext } from './actor'

/**
 * Contexto de quem usa o app sem entrar (ator `guest`): só leitura do que é público. A conta já foi resolvida e
 * conferida (ativa) pelo cabeçalho `X-Business`, então não há o que reler no banco.
 */
export function createGuestContext(i: {
  businessId: string
  timeZone: string
  request: RequestInfo
  clock?: () => Date
}): TenantContext {
  return {
    businessId: i.businessId,
    timeZone: i.timeZone,
    actor: { kind: 'guest' },
    db: tenantDb(i.businessId),
    clock: i.clock ?? (() => new Date()),
    request: i.request,
    channel: 'app',
  }
}
