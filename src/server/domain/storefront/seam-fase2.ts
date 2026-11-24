import type { ServiceView } from '@/server/domain/catalog/services'
import type { TenantContext } from '@/server/auth/actor'

/*
 * Costuras com a fase 2 (pet shop): preço "a partir de" por porte e o nicho da loja. Esta base ainda não tem variantes de
 * preço nem nicho, então o serviço tem um preço só e nenhuma loja é de pet shop. A integração troca os dois corpos por
 * `fromPrice(service)` (menor preço visível entre as variantes) e por `getNicheSettings` (nicho pet, atende gatos).
 */

/** "a partir de": o menor preço do serviço e se ele varia por porte. Sem variantes, é o próprio preço e nunca varia. */
export function precoAPartirDe(service: Pick<ServiceView, 'priceCents'>): { cents: number; varies: boolean } | null {
  return { cents: service.priceCents, varies: false }
}

/** O nicho da loja: pet shop (com ou sem gatos). */
export async function nichoDaLoja(ctx: TenantContext): Promise<{ petNiche: boolean; servesCats: boolean }> {
  void ctx
  return { petNiche: false, servesCats: false }
}
