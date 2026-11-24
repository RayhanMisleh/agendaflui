import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import type { CustomerVisit } from '@/server/auth/customer-access'
import { getModules } from '@/server/domain/modules'
import { getStoreNiche } from '@/server/domain/settings/niche-settings'
import { ClienteShell } from '@/ui/shells'
import { carregarLoja } from './loja'

/**
 * Moldura de toda tela de cliente: marca da loja pelo endereço, navegação (Pets só em loja de pet shop) e a pessoa. A visita
 * já passou por `requireCustomer`; aqui só se monta a moldura. Loja que sumiu entre a visita e a moldura volta à página dela.
 */
export async function ClienteFrame(p: {
  visit: CustomerVisit
  title: string
  hideTitle?: boolean
  back?: { href: string; label: string }
  actions?: ReactNode
  children: ReactNode
}) {
  const { visit } = p
  const [loja, nicho] = await Promise.all([carregarLoja(visit.store.slug), getStoreNiche(visit.ctx)])
  if (!loja) return redirect(`/${visit.store.slug}`)
  return (
    <ClienteShell
      store={{ name: loja.brand.name, logoUrl: loja.brand.logoUrl, symbolUrl: loja.brand.symbolUrl, slug: visit.store.slug }}
      pets={nicho.petNiche}
      person={{ name: visit.person.name }}
      title={p.title}
      {...(p.hideTitle ? { hideTitle: true } : {})}
      {...(p.back ? { back: p.back } : {})}
      {...(p.actions ? { actions: p.actions } : {})}
    >
      {p.children}
    </ClienteShell>
  )
}

/** Os módulos ligados da loja (menu "Mais", Prêmios, Loja). */
export function modulosDaLoja(visit: CustomerVisit) {
  return getModules(visit.ctx.db, visit.ctx.businessId)
}
