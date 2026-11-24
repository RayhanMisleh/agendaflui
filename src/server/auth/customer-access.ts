import 'server-only'
import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import type { RequestInfo, TenantContext } from './actor'
import { createGuestContext } from './guest-context'
import { needsPetQuiz } from './pet-onboarding'
import { hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import { getPersonSession } from './session'
import { findOpenStore, storeRelation, type StoreRef } from './store-join'

/*
 * A visita a uma loja (`/<slug>/**`): a loja está aberta? Há pessoa entrada? Ela é cliente ativo DESTA loja? Nada vem do slug
 * nem da sessão sozinhos: o vínculo de cliente é lido do banco a cada chamada (nunca em cache entre requisições), e a loja
 * lembrada na sessão (`customerBusinessId`) não dá acesso a nenhuma outra. Só aqui (pasta `auth`) se lê o Prisma cru.
 */

export type OpenStore = StoreRef & { timeZone: string }

export type StorePerson = { userId: string; name: string; email: string; phone: string | null }

export type StoreVisit =
  | { kind: 'unavailable' }
  | { kind: 'anonymous'; store: OpenStore; ctx: TenantContext }
  | { kind: 'visitor'; store: OpenStore; ctx: TenantContext; person: StorePerson; isStaff: boolean; blocked: boolean }
  | { kind: 'customer'; store: OpenStore; ctx: TenantContext; person: StorePerson; customerId: string; isStaff: boolean }

export type CustomerVisit = Extract<StoreVisit, { kind: 'customer' }>

/** A loja aberta ao público (conta ativa) com o fuso dela; slug inválido, reservado, inexistente ou não ativa: `null`. */
export async function loadOpenStore(slug: string): Promise<OpenStore | null> {
  const ref = await findOpenStore(slug)
  if (!ref) return null
  const b = await prisma.business.findUnique({ where: { id: ref.businessId }, select: { timezone: true } })
  return b ? { ...ref, timeZone: b.timezone } : null
}

export async function resolveStoreVisit(i: { token: string | undefined; slug: string; request: RequestInfo; now?: Date }): Promise<StoreVisit> {
  const store = await loadOpenStore(i.slug)
  if (!store) return { kind: 'unavailable' }
  const clock = i.now ? (): Date => i.now as Date : undefined
  const guest = createGuestContext({ businessId: store.businessId, timeZone: store.timeZone, request: i.request, ...(clock ? { clock } : {}) })
  const session = await getPersonSession(i.token, i.now)
  if (!session || session.kind !== 'person') return { kind: 'anonymous', store, ctx: guest }

  const pessoa = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, phone: true } })
  if (!pessoa) return { kind: 'anonymous', store, ctx: guest }
  const person: StorePerson = { userId: pessoa.id, name: pessoa.name, email: pessoa.email, phone: pessoa.phone }
  const [ligado, vinculo] = await Promise.all([
    prisma.customer.findUnique({
      where: { businessId_userId: { businessId: store.businessId, userId: pessoa.id } },
      select: { id: true, name: true, archivedAt: true, anonymizedAt: true },
    }),
    prisma.membership.findFirst({ where: { userId: pessoa.id, businessId: store.businessId, active: true }, select: { id: true } }),
  ])
  const isStaff = vinculo !== null
  if (!ligado) {
    // Balcão arquivado com o e-mail da pessoa também bloqueia: entrar não reativa.
    const relacao = await storeRelation(pessoa.id, store.businessId)
    return { kind: 'visitor', store, ctx: guest, person, isStaff, blocked: relacao.blocked }
  }
  if (ligado.archivedAt !== null || ligado.anonymizedAt !== null) return { kind: 'visitor', store, ctx: guest, person, isStaff, blocked: true }
  const ctx: TenantContext = {
    businessId: store.businessId,
    timeZone: store.timeZone,
    actor: { kind: 'customer', customerId: ligado.id, name: ligado.name },
    db: tenantDb(store.businessId),
    clock: clock ?? (() => new Date()),
    request: i.request,
    channel: 'app',
  }
  return { kind: 'customer', store, ctx, person, customerId: ligado.id, isStaff }
}

export type CustomerRate = 'booking' | 'availability' | 'redeem' | 'postalCode' | 'shippingQuote' | 'order'

/** Conta uma chamada do cliente no limite da regra (por loja e cliente); estourou: "Muitas tentativas seguidas…". */
export async function assertCustomerRate(v: CustomerVisit, rule: CustomerRate, now: Date): Promise<void> {
  const r = await hitRateLimit(limitKey(`cliente:${rule}`, `${v.store.businessId}:${v.customerId}`), LIMITS[rule], now)
  if (!r.allowed) {
    throw new DomainError('conflict', 'Muitas tentativas seguidas. Espere um minuto e tente de novo.', { reason: 'rate_limited' })
  }
}

/**
 * Para onde o cliente vai logo depois de entrar, cadastrar ou usar a conta na loja: loja pet sem pet ativo → o quiz (levando
 * o `volta`); senão o `volta` (já validado por `safeReturnPath`) ou a página da loja.
 */
export async function customerLandingPath(v: CustomerVisit, back: string | null): Promise<string> {
  if (await needsPetQuiz(v)) {
    const base = `/${v.store.slug}/boas-vindas`
    return back ? `${base}?volta=${encodeURIComponent(back)}` : base
  }
  return back ?? `/${v.store.slug}`
}
