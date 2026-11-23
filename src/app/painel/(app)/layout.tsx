import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { requireTenant } from '@/server/auth/guards'
import { getPublicBrandById } from '@/server/domain/platform/branding'
import { iconesDaConta } from '../_marca'

/** O favicon da conta ativa na aba do navegador, quando a conta enviou um. */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await requireTenant()
  const icons = iconesDaConta((await getPublicBrandById(ctx.businessId))?.faviconUrl ?? null)
  return icons ? { icons } : {}
}

// O layout não roda de novo a cada navegação: cada página e action também chama requireTenant.
export default async function PainelAppLayout({ children }: { children: ReactNode }) {
  await requireTenant()
  return children
}
