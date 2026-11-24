import type { TenantContext } from '@/server/auth/actor'
import { authorize, DomainError, orNotFound, z } from '@/server/domain/errors'
import { isCustomer } from '@/server/domain/input'
import { isServiceOffered, priceFor } from '@/server/domain/catalog/pricing'
import { listServices, type ServiceView } from '@/server/domain/catalog/services'
import { requirePetNiche } from '@/server/domain/settings/niche-settings'
import { variantDef, variantOfPet } from '@/server/niches'

export type PetServiceOption = {
  service: ServiceView
  offered: boolean
  priceCents: number | null
  durationMin: number | null
  reason: string | null
}

/**
 * Os serviços ativos com preço e tempo para um pet. A equipe recebe todos, com `offered` e o motivo de não serem feitos
 * para esse animal; o cliente recebe só os oferecidos, e só do próprio pet (o de outro é `not_found`).
 */
export async function listServicesForPet(ctx: TenantContext, petId: string): Promise<PetServiceOption[]> {
  const customer = isCustomer(ctx)
  if (!customer) authorize(ctx, 'view_own_agenda')
  const notFound = () => new DomainError('not_found', 'Pet não encontrado.')
  if (!z.uuid().safeParse(petId).success) throw notFound()
  const { options } = await requirePetNiche(ctx)
  const pet = orNotFound(await ctx.db.pet.findUnique({ where: { id: petId } }), 'Pet')
  if (customer && (ctx.actor.kind !== 'customer' || ctx.actor.customerId !== pet.customerId)) throw notFound()
  const variant = variantOfPet(pet)
  const label = variantDef(variant).label
  const who = customer ? 'customer' : 'staff'
  const lista: PetServiceOption[] = []
  for (const service of await listServices(ctx)) {
    const offered = isServiceOffered(service, variant, { who, servesCats: options.servesCats })
    if (!offered && customer) continue
    const price = offered ? priceFor(service, variant) : null
    const reason = offered
      ? null
      : variant === 'CAT' && !options.servesCats && who === 'customer'
        ? 'A loja não atende gatos no momento'
        : `Não atende ${label}`
    lista.push({ service, offered, priceCents: price?.priceCents ?? null, durationMin: price?.durationMin ?? null, reason })
  }
  return lista
}
