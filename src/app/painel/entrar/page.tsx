import type { Metadata } from 'next'
import { BRAND_COOKIE, readCookie } from '@/server/auth/guards'
import { getPublicBrandBySlug } from '@/server/domain/platform/branding'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { PainelEntrada } from './PainelEntrada'

export const metadata: Metadata = { title: 'Entrar | AgendaFlui' }

const MARCA_PADRAO = {
  name: 'AgendaFlui',
  logoUrl: null,
  symbolUrl: null,
  loginImageUrl: null,
  loginMessage: null,
  platform: true,
  theme: deriveTheme(AGENDAFLUI_BRAND),
}

/** Entrada genérica: usa a marca da última conta acessada neste navegador, se ainda estiver ativa. */
export default async function EntrarPage() {
  const slug = await readCookie(BRAND_COOKIE)
  const lembrada = slug ? await getPublicBrandBySlug(slug) : null
  return <PainelEntrada marca={lembrada ?? MARCA_PADRAO} />
}
