import 'server-only'
import { prisma } from '@/server/db/client'
import type { PersonSession } from './session'

/*
 * "Para onde a pessoa vai": função única, usada em `/` e depois de toda entrada. Equipe ativa vai para o painel; senão,
 * cliente de uma loja vai para ela; de várias, para a última usada na sessão (ou a ligação mais recente); de nenhuma, para a
 * tela "sem loja". Só abrir `/<slug>` não torna ninguém cliente.
 */

export type DestinationFacts = {
  /** Vínculo de equipe ativo numa conta ativa. */
  staff: boolean
  /** Lojas em que a pessoa é cliente (não arquivado nem removido, conta ativa). */
  stores: { businessId: string; slug: string; linkedAt: Date }[]
  /** Última loja usada guardada na sessão. */
  lastStoreId: string | null
}

export type Destination = { kind: 'painel' } | { kind: 'store'; slug: string } | { kind: 'no_store' }

export function decideDestination(f: DestinationFacts): Destination {
  if (f.staff) return { kind: 'painel' }
  const [primeira] = f.stores
  if (!primeira) return { kind: 'no_store' }
  if (f.stores.length === 1) return { kind: 'store', slug: primeira.slug }
  const ultima = f.stores.find((s) => s.businessId === f.lastStoreId)
  if (ultima) return { kind: 'store', slug: ultima.slug }
  // Sem última usada (ou ela saiu da lista): a ligação mais recente; no empate, a ordem do slug mantém o resultado estável.
  const recente = [...f.stores].sort((a, b) => b.linkedAt.getTime() - a.linkedAt.getTime() || a.slug.localeCompare(b.slug))[0]
  return recente ? { kind: 'store', slug: recente.slug } : { kind: 'no_store' }
}

export function destinationPath(d: Destination): string {
  switch (d.kind) {
    case 'painel':
      return '/painel'
    case 'store':
      return `/${d.slug}`
    case 'no_store':
      return '/'
  }
}

export async function loadDestinationFacts(userId: string, lastStoreId: string | null): Promise<DestinationFacts> {
  const [vinculo, clientes] = await Promise.all([
    prisma.membership.findFirst({ where: { userId, active: true, business: { status: 'ACTIVE' } }, select: { id: true } }),
    prisma.customer.findMany({
      where: { userId, archivedAt: null, anonymizedAt: null, business: { status: 'ACTIVE' } },
      select: { businessId: true, linkedAt: true, business: { select: { slug: true } } },
    }),
  ])
  return {
    staff: vinculo !== null,
    stores: clientes.flatMap((c) => (c.linkedAt ? [{ businessId: c.businessId, slug: c.business.slug, linkedAt: c.linkedAt }] : [])),
    lastStoreId,
  }
}

/** Destino de uma pessoa recém-identificada (login, cadastro, Google). */
export async function destinationForUser(userId: string, lastStoreId: string | null): Promise<Destination> {
  return decideDestination(await loadDestinationFacts(userId, lastStoreId))
}

export async function destinationFor(session: PersonSession): Promise<Destination> {
  if (session.kind === 'support') return { kind: 'painel' }
  return destinationForUser(session.user.id, session.customerBusinessId)
}
