import type { TenantContext } from '@/server/auth/actor'
import { listLiveBanners } from '@/server/domain/banners/banners'
import { DomainError, orNotFound } from '@/server/domain/errors'
import { getCustomerLoyalty } from '@/server/domain/loyalty/ledger'
import { getModules } from '@/server/domain/modules'
import { getNextAppointment } from '@/server/domain/scheduling/agenda'
import type { AppointmentView } from '@/server/domain/scheduling/appointment-view'
import { listServicesForPet } from '@/server/domain/catalog/pet-services'
import { listMyPets, type PetView } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { listProfessionals } from '@/server/domain/team/professionals'

/*
 * Início do cliente e "Agendar de novo". Em loja de pet shop a sugestão é do pet do último atendimento (ativo, e só com os
 * serviços oferecidos a ele hoje) e `query` leva `pet=`; em loja sem nicho, `petId` e `petName` são nulos.
 */

export type RebookSuggestion = {
  petId: string | null
  petName: string | null
  serviceIds: string[]
  serviceNames: string[]
  professionalId: string | null
  professionalName: string | null
  /** Consulta pronta para o endereço de agendar: `?[pet=<id>&]servicos=<a>,<b>[&profissional=<id>]`. */
  query: string
}

export type CustomerHome = {
  firstName: string
  /** Pets ativos do cliente (vazio em loja sem nicho). */
  pets: PetView[]
  next: AppointmentView | null
  rebook: RebookSuggestion | null
  banners: { id: string; title: string; imageUrl: string; linkUrl: string | null }[]
  points: number | null
}

function ownCustomerId(ctx: TenantContext): string {
  if (ctx.actor.kind !== 'customer') throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
  return ctx.actor.customerId
}

/**
 * O último atendimento concluído do cliente (senão o último que já passou e foi confirmado), com o que ainda dá para repetir:
 * serviços ativos (e do clube só para quem é do clube) e o profissional, se ainda ativo e se faz tudo.
 */
export async function getRebookSuggestion(ctx: TenantContext): Promise<RebookSuggestion | null> {
  const customerId = ownCustomerId(ctx)
  const now = ctx.clock()
  const include = { items: { orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }] } }
  const last =
    (await ctx.db.appointment.findFirst({ where: { customerId, status: 'COMPLETED' }, include, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] })) ??
    (await ctx.db.appointment.findFirst({ where: { customerId, status: 'CONFIRMED', endsAt: { lte: now } }, include, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] }))
  if (!last) return null
  const { niche } = await getNicheSettings(ctx)
  let pet: { id: string; name: string } | null = null
  let oferecidos: Set<string> | null = null
  if (niche !== null) {
    if (last.petId === null) return null
    const atual = await ctx.db.pet.findUnique({ where: { id: last.petId }, select: { id: true, name: true, archivedAt: true } })
    if (!atual || atual.archivedAt !== null) return null
    pet = { id: atual.id, name: atual.name }
    // Só o que é feito para o pet hoje (porte atual; gato com gatos desligados não recebe nada).
    oferecidos = new Set((await listServicesForPet(ctx, atual.id)).filter((o) => o.offered).map((o) => o.service.id))
  }
  const customer = orNotFound(await ctx.db.customer.findUnique({ where: { id: customerId }, select: { isClubMember: true } }), 'Cliente')
  const ids = last.items.map((i) => i.serviceId)
  const vivos = await ctx.db.service.findMany({ where: { id: { in: ids }, active: true, archivedAt: null } })
  const porId = new Map(
    vivos.filter((s) => (customer.isClubMember || !s.clubOnly) && (oferecidos === null || oferecidos.has(s.id))).map((s) => [s.id, s]),
  )
  const mantidos = ids.flatMap((id) => {
    const s = porId.get(id)
    return s ? [s] : []
  })
  if (mantidos.length === 0) return null
  const serviceIds = mantidos.map((s) => s.id)
  const quem = await listProfessionals(ctx, { serviceIds })
  const profissional = quem.find((p) => p.id === last.professionalId) ?? null
  const params = [
    ...(pet ? [`pet=${pet.id}`] : []),
    `servicos=${serviceIds.join(',')}`,
    ...(profissional ? [`profissional=${profissional.id}`] : []),
  ]
  return {
    petId: pet?.id ?? null,
    petName: pet?.name ?? null,
    serviceIds,
    serviceNames: mantidos.map((s) => s.name),
    professionalId: profissional?.id ?? null,
    professionalName: profissional?.name ?? null,
    query: `?${params.join('&')}`,
  }
}

/** Tudo do Início de uma vez. Só o cliente (ator `customer`): o próximo horário é sempre o dele. */
export async function getCustomerHome(ctx: TenantContext): Promise<CustomerHome> {
  const customerId = ownCustomerId(ctx)
  const [customer, modules, nicho] = await Promise.all([
    ctx.db.customer.findUnique({ where: { id: customerId }, select: { name: true } }),
    getModules(ctx.db, ctx.businessId),
    getNicheSettings(ctx),
  ])
  const nome = orNotFound(customer, 'Cliente').name
  const [next, rebook, banners, loyalty, pets] = await Promise.all([
    getNextAppointment(ctx, customerId),
    getRebookSuggestion(ctx),
    modules.banners ? listLiveBanners(ctx) : Promise.resolve([]),
    modules.loyalty ? getCustomerLoyalty(ctx, customerId) : Promise.resolve(null),
    nicho.niche !== null ? listMyPets(ctx) : Promise.resolve([]),
  ])
  return { firstName: nome.trim().split(/\s+/)[0] ?? nome, pets, next, rebook, banners, points: loyalty ? loyalty.balance : null }
}
