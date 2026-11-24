import type { TenantContext } from '@/server/auth/actor'
import { listLiveBanners } from '@/server/domain/banners/banners'
import { DomainError, orNotFound } from '@/server/domain/errors'
import { getCustomerLoyalty } from '@/server/domain/loyalty/ledger'
import { getModules } from '@/server/domain/modules'
import { getNextAppointment } from '@/server/domain/scheduling/agenda'
import type { AppointmentView } from '@/server/domain/scheduling/appointment-view'
import { listProfessionals } from '@/server/domain/team/professionals'

/*
 * Início do cliente e "Agendar de novo". `pets` e o pet da sugestão entram com a fase 2 (cadastro de pets): nesta base o
 * cliente não tem pet, então `petId` e `petName` da sugestão são nulos e `query` não leva `pet=`.
 */

export type RebookSuggestion = {
  petId: string | null
  petName: string | null
  serviceIds: string[]
  serviceNames: string[]
  professionalId: string | null
  professionalName: string | null
  /** Consulta pronta para o endereço de agendar: `?servicos=<a>,<b>[&profissional=<id>]` (com `pet=<id>` na fase 2). */
  query: string
}

export type CustomerHome = {
  firstName: string
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
  const customer = orNotFound(await ctx.db.customer.findUnique({ where: { id: customerId }, select: { isClubMember: true } }), 'Cliente')
  const ids = last.items.map((i) => i.serviceId)
  const vivos = await ctx.db.service.findMany({ where: { id: { in: ids }, active: true, archivedAt: null } })
  const porId = new Map(vivos.filter((s) => customer.isClubMember || !s.clubOnly).map((s) => [s.id, s]))
  const mantidos = ids.flatMap((id) => {
    const s = porId.get(id)
    return s ? [s] : []
  })
  if (mantidos.length === 0) return null
  const serviceIds = mantidos.map((s) => s.id)
  const quem = await listProfessionals(ctx, { serviceIds })
  const profissional = quem.find((p) => p.id === last.professionalId) ?? null
  const params = [`servicos=${serviceIds.join(',')}`, ...(profissional ? [`profissional=${profissional.id}`] : [])]
  return {
    petId: null,
    petName: null,
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
  const [customer, modules] = await Promise.all([
    ctx.db.customer.findUnique({ where: { id: customerId }, select: { name: true } }),
    getModules(ctx.db, ctx.businessId),
  ])
  const nome = orNotFound(customer, 'Cliente').name
  const [next, rebook, banners, loyalty] = await Promise.all([
    getNextAppointment(ctx, customerId),
    getRebookSuggestion(ctx),
    modules.banners ? listLiveBanners(ctx) : Promise.resolve([]),
    modules.loyalty ? getCustomerLoyalty(ctx, customerId) : Promise.resolve(null),
  ])
  return { firstName: nome.trim().split(/\s+/)[0] ?? nome, next, rebook, banners, points: loyalty ? loyalty.balance : null }
}
