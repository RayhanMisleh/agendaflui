import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { uploadUrl } from '@/server/storage/images'
import { deriveTheme, type ThemeTokens } from '@/ui/theme/derive'

/** O que a tela de entrada pode saber de uma conta antes de haver sessão. Nada além disto sai daqui. */
export type PublicBrand = {
  businessId: string
  slug: string
  name: string
  logoUrl: string | null
  symbolUrl: string | null
  loginImageUrl: string | null
  loginMessage: string | null
  theme: ThemeTokens
}

// Seleção explícita: observações internas, documento e contato da conta nunca são lidos.
const SELECAO = {
  id: true,
  slug: true,
  name: true,
  branding: {
    select: {
      displayName: true,
      loginMessage: true,
      primaryColor: true,
      accentColor: true,
      coverMaterial: true,
      paperTone: true,
      fontPair: true,
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
    loginMessage: marca.loginMessage,
    theme: deriveTheme({
      primary: marca.primaryColor,
      accent: marca.accentColor,
      material: marca.coverMaterial,
      paper: marca.paperTone,
      fontPair: marca.fontPair,
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
