import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { uploadUrl } from '@/server/storage/images'
import { deriveTheme, type ThemeTokens } from '@/shared/theme/derive'

/** O que a tela de entrada pode saber de uma conta antes de haver sessão. Nada além disto sai daqui. */
export type PublicBrand = {
  businessId: string
  slug: string
  name: string
  logoUrl: string | null
  symbolUrl: string | null
  loginImageUrl: string | null
  theme: ThemeTokens
}

// Seleção explícita: documento e contato da conta nunca são lidos.
const SELECAO = {
  id: true,
  slug: true,
  name: true,
  branding: {
    select: {
      displayName: true,
      primaryColor: true,
      accentColor: true,
      coverMaterial: true,
      logo: { select: { path: true } },
      symbol: { select: { path: true } },
      loginImage: { select: { path: true } },
    },
  },
} satisfies Prisma.BusinessSelect

type Linha = Prisma.BusinessGetPayload<{ select: typeof SELECAO }>

function paraMarca(linha: Linha | null): PublicBrand | null {
  const marca = linha?.branding
  if (!linha || !marca) return null
  return {
    businessId: linha.id,
    slug: linha.slug,
    name: marca.displayName || linha.name,
    logoUrl: uploadUrl(marca.logo),
    symbolUrl: uploadUrl(marca.symbol),
    loginImageUrl: uploadUrl(marca.loginImage),
    theme: deriveTheme({
      primary: marca.primaryColor,
      accent: marca.accentColor,
      material: marca.coverMaterial,
    }),
  }
}

/** Marca de uma conta ativa pelo endereço de entrada. `null` se não existe ou não está ativa. */
export async function getPublicBrandBySlug(slug: string): Promise<PublicBrand | null> {
  return paraMarca(await prisma.business.findFirst({ where: { slug, status: 'ACTIVE' }, select: SELECAO }))
}

export async function getPublicBrandById(businessId: string): Promise<PublicBrand | null> {
  return paraMarca(await prisma.business.findFirst({ where: { id: businessId, status: 'ACTIVE' }, select: SELECAO }))
}
