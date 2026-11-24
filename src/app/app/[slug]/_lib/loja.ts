import { cache } from 'react'
import type { Metadata } from 'next'
import { findOpenStore, type StoreRef } from '@/server/auth/store-join'
import { getPublicBrandBySlug, type PublicBrand } from '@/server/domain/platform/branding'
import { iconesDaConta } from '@/app/app/_lib/marca'

export type Loja = { ref: StoreRef; brand: PublicBrand }

/** A loja aberta (conta ativa) e a marca dela pelo endereço; `null` se não existe, não está ativa ou o nome é reservado. */
export const carregarLoja = cache(async (slug: string): Promise<Loja | null> => {
  const ref = await findOpenStore(slug)
  if (!ref) return null
  const brand = await getPublicBrandBySlug(ref.slug)
  return brand ? { ref, brand } : null
})

/** `<Loja> | Agenda Flui`, com o favicon da loja quando ela enviou um; loja fechada não aparece em buscadores. */
export async function metadataDaLoja(slug: string, titulo?: string): Promise<Metadata> {
  const loja = await carregarLoja(slug)
  if (!loja) return { title: 'Loja indisponível | Agenda Flui', robots: { index: false, follow: false } }
  const icons = iconesDaConta(loja.brand.faviconUrl)
  return { title: `${titulo ? `${titulo} · ` : ''}${loja.brand.name} | Agenda Flui`, ...(icons ? { icons } : {}) }
}

/** Marca da tela de entrada com a cara da loja. */
export function marcaDaLoja(brand: PublicBrand) {
  return { name: brand.name, logoUrl: brand.logoUrl, symbolUrl: brand.symbolUrl, loginImageUrl: brand.loginImageUrl }
}
