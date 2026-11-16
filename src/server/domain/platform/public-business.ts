import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { DomainError } from '@/server/domain/errors'
import { publicUploadUrl } from '@/server/storage/images'
import { deriveTheme } from '@/shared/theme/derive'

type Term = { singular: string; plural: string }

/** O que o app mostra de uma conta antes do login. Cada campo é montado à mão (lista positiva): nada vem por espalhamento. */
export type PublicBusiness = {
  id: string
  slug: string
  name: string
  timeZone: string
  brand: {
    logoUrl: string | null
    symbolUrl: string | null
    primary: string
    accent: string
    material: 'LEATHER' | 'LINEN' | 'WOOD' | 'ENAMEL'
    paper: 'WHITE' | 'CREAM' | 'GRAY'
    fontPair: 'CLASSIC' | 'MODERN' | 'FRIENDLY'
    /** Variáveis de tema derivadas da marca (`--cover`, `--accent` …), prontas para o app aplicar. */
    tokens: Record<string, string>
  }
  terms: { professional: Term; customer: Term; points: Term; club: string }
  modules: { loyalty: boolean; banners: boolean; store: boolean; vouchers: boolean }
  rules: { slotStepMin: number; minLeadMin: number; maxAdvanceDays: number; customerChangeWindowMin: number }
}

// Seleção explícita: documento, contato, observações internas e situação da conta nunca são lidos.
const SELECAO = {
  id: true,
  slug: true,
  name: true,
  timezone: true,
  branding: {
    select: {
      displayName: true,
      primaryColor: true,
      accentColor: true,
      coverMaterial: true,
      paperTone: true,
      fontPair: true,
      logo: { select: { path: true } },
      symbol: { select: { path: true } },
    },
  },
  modules: { select: { loyalty: true, banners: true, store: true, vouchers: true } },
  settings: {
    select: {
      slotStepMin: true,
      minLeadMin: true,
      maxAdvanceDays: true,
      customerChangeWindowMin: true,
      termProfessionalSingular: true,
      termProfessionalPlural: true,
      termCustomerSingular: true,
      termCustomerPlural: true,
      termPointsSingular: true,
      termPointsPlural: true,
      termClub: true,
    },
  },
} satisfies Prisma.BusinessSelect

/** Dados públicos de uma conta ativa. Conta sem marca, módulos ou configurações (não deveria existir) é `not_found`. */
export async function getPublicBusiness(businessId: string): Promise<PublicBusiness> {
  const row = await prisma.business.findFirst({ where: { id: businessId, status: 'ACTIVE' }, select: SELECAO })
  const { branding, modules, settings } = row ?? {}
  if (!row || !branding || !modules || !settings) throw new DomainError('not_found', 'Conta não encontrada.')
  const theme = deriveTheme({
    primary: branding.primaryColor,
    accent: branding.accentColor,
    material: branding.coverMaterial,
    paper: branding.paperTone,
    fontPair: branding.fontPair,
  })
  return {
    id: row.id,
    slug: row.slug,
    name: branding.displayName || row.name,
    timeZone: row.timezone,
    brand: {
      logoUrl: publicUploadUrl(branding.logo),
      symbolUrl: publicUploadUrl(branding.symbol),
      primary: branding.primaryColor,
      accent: branding.accentColor,
      material: branding.coverMaterial,
      paper: branding.paperTone,
      fontPair: branding.fontPair,
      tokens: { ...theme.vars },
    },
    terms: {
      professional: { singular: settings.termProfessionalSingular, plural: settings.termProfessionalPlural },
      customer: { singular: settings.termCustomerSingular, plural: settings.termCustomerPlural },
      points: { singular: settings.termPointsSingular, plural: settings.termPointsPlural },
      club: settings.termClub,
    },
    modules: {
      loyalty: modules.loyalty,
      banners: modules.banners,
      store: modules.store,
      vouchers: modules.vouchers,
    },
    rules: {
      slotStepMin: settings.slotStepMin,
      minLeadMin: settings.minLeadMin,
      maxAdvanceDays: settings.maxAdvanceDays,
      customerChangeWindowMin: settings.customerChangeWindowMin,
    },
  }
}
