import type { TenantContext } from '@/server/auth/actor'
import { audit } from '@/server/domain/audit'
import { normalizeContactPhone, formatPhone, normalizeEmail } from '@/server/domain/customers/contact'
import { authorize, orNotFound, parse, z } from '@/server/domain/errors'
import { replaceBrandImage } from '@/server/domain/platform/brand-image'
import { brandColorSchema } from '@/server/domain/platform/customization'
import { displayNameSchema } from '@/server/domain/settings/text-rules'
import { staleSettings } from '@/server/domain/settings/versioned'
import { uploadUrl } from '@/server/storage/images'
import type { CoverMaterial } from '@/shared/theme/derive'

export type BusinessProfile = {
  name: string
  contactEmail: string | null
  contactPhone: string | null
  phoneLabel: string | null
  timeZone: string
  logoUrl: string | null
  version: number
}

/** Só o que o dono muda nos dados do negócio. Identificador, fuso, cores e módulos são do painel dev e não existem aqui. */
export type BusinessProfileInput = { name: string; contactEmail: string | null; contactPhone: string | null }

const optional = <T>(parseValue: (v: string) => T, fallback: string) =>
  z
    .string()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v.trim() === '') return null
      try {
        return parseValue(v)
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof RangeError ? e.message : fallback })
        return z.NEVER
      }
    })

const profileSchema = z.strictObject({
  name: displayNameSchema,
  contactEmail: optional(normalizeEmail, 'Informe um e-mail válido.'),
  contactPhone: optional(normalizeContactPhone, 'Informe um telefone válido.'),
})

const versionSchema = z.number('Informe a versão lida.').int().min(1)

export async function getBusinessProfile(ctx: TenantContext): Promise<BusinessProfile> {
  authorize(ctx, 'manage_settings')
  const [business, branding] = await Promise.all([
    ctx.db.business.findUnique({ where: { id: ctx.businessId }, select: { email: true, phone: true, timezone: true, version: true } }),
    ctx.db.businessBranding.findUnique({
      where: { businessId: ctx.businessId },
      select: { displayName: true, logo: { select: { path: true } } },
    }),
  ])
  const b = orNotFound(business, 'Conta')
  const m = orNotFound(branding, 'Marca da conta')
  return {
    name: m.displayName,
    contactEmail: b.email,
    contactPhone: b.phone,
    phoneLabel: b.phone === null ? null : formatPhone(b.phone),
    timeZone: b.timezone,
    logoUrl: uploadUrl(m.logo),
    version: b.version,
  }
}

/**
 * O dono muda nome de exibição e contato. A versão é a do negócio (`businesses.version`, a mesma que o painel dev usa em
 * `updateBusinessData`): quem grava sobre uma versão antiga recebe `conflict` `stale_version`, seja o dono ou o admin. Sem
 * mudança, não grava, não sobe a versão e não audita. A auditoria guarda o nome de antes e depois e só quais campos de contato
 * mudaram (nunca o e-mail nem o telefone).
 */
export async function updateBusinessProfile(ctx: TenantContext, version: number, input: BusinessProfileInput): Promise<BusinessProfile> {
  authorize(ctx, 'manage_account')
  const v = parse(versionSchema, version)
  const i = parse(profileSchema, input)
  await ctx.db.$transaction(async (tx) => {
    const branding = orNotFound(await tx.businessBranding.findUnique({ where: { businessId: ctx.businessId } }), 'Marca da conta')
    const business = orNotFound(
      await tx.business.findUnique({ where: { id: ctx.businessId }, select: { email: true, phone: true, version: true } }),
      'Conta',
    )
    const fields: string[] = []
    if (branding.displayName !== i.name) fields.push('name')
    if (business.email !== i.contactEmail) fields.push('contactEmail')
    if (business.phone !== i.contactPhone) fields.push('contactPhone')
    if (fields.length === 0) {
      if (business.version !== v) throw staleSettings()
      return
    }
    // Uma instrução só, condicionada à versão lida: qualquer mudança na conta (dono ou painel dev) no meio do caminho falha aqui.
    const r = await tx.business.updateMany({
      where: { id: ctx.businessId, version: v },
      data: {
        ...(fields.includes('contactEmail') ? { email: i.contactEmail } : {}),
        ...(fields.includes('contactPhone') ? { phone: i.contactPhone } : {}),
        version: { increment: 1 },
      },
    })
    if (r.count === 0) throw staleSettings()
    if (fields.includes('name')) {
      await tx.businessBranding.update({
        where: { businessId: ctx.businessId },
        data: { displayName: i.name, version: { increment: 1 } },
      })
    }
    await audit(
      ctx,
      {
        action: 'business_profile.updated',
        targetType: 'business',
        targetId: ctx.businessId,
        metadata: {
          fields,
          changes: fields.includes('name') ? { name: { from: branding.displayName, to: i.name } } : {},
        },
      },
      tx,
    )
  })
  return getBusinessProfile(ctx)
}

/** Troca (ou, com `null`, remove) a logo, pela mesma função de imagem da marca do painel dev (mesmas regras de imagem). */
export async function setBusinessLogo(ctx: TenantContext, file: { bytes: Uint8Array } | null): Promise<BusinessProfile> {
  authorize(ctx, 'manage_account')
  await replaceBrandImage(ctx, 'logo', file)
  return getBusinessProfile(ctx)
}

/** O visual da conta como o painel dev gravou: o dono só vê (e troca a logo); cores e barra lateral são do painel dev. */
export type BusinessAppearance = {
  primary: string
  accent: string
  material: CoverMaterial
  logoUrl: string | null
  /** A versão da marca (`business_branding.version`), a mesma que o painel dev usa em `updateBrand`. */
  version: number
}

export async function getBusinessAppearance(ctx: TenantContext): Promise<BusinessAppearance> {
  authorize(ctx, 'manage_account')
  const m = orNotFound(
    await ctx.db.businessBranding.findUnique({
      where: { businessId: ctx.businessId },
      select: { primaryColor: true, accentColor: true, coverMaterial: true, version: true, logo: { select: { path: true } } },
    }),
    'Marca da conta',
  )
  return { primary: m.primaryColor, accent: m.accentColor, material: m.coverMaterial, logoUrl: uploadUrl(m.logo), version: m.version }
}

const coresSchema = z.strictObject({ primary: brandColorSchema, accent: brandColorSchema })

/**
 * O dono muda as duas cores da marca (material e barra lateral seguem do painel dev). A gravação é uma instrução só,
 * condicionada à versão da marca lida: versão velha vira `conflict` `stale_version`. Sem mudança, não grava nem audita.
 * A auditoria (`brand.updated`) guarda `{ from, to }` só do que mudou.
 */
export async function updateBrandColors(ctx: TenantContext, version: number, input: { primary: string; accent: string }): Promise<BusinessAppearance> {
  authorize(ctx, 'manage_account')
  const v = parse(versionSchema, version)
  const i = parse(coresSchema, input)
  await ctx.db.$transaction(async (tx) => {
    const atual = orNotFound(await tx.businessBranding.findUnique({ where: { businessId: ctx.businessId } }), 'Marca da conta')
    const changes: Record<string, { from: string; to: string }> = {}
    if (atual.primaryColor !== i.primary) changes.primary = { from: atual.primaryColor, to: i.primary }
    if (atual.accentColor !== i.accent) changes.accent = { from: atual.accentColor, to: i.accent }
    if (Object.keys(changes).length === 0) {
      if (atual.version !== v) throw staleSettings()
      return
    }
    const r = await tx.businessBranding.updateMany({
      where: { businessId: ctx.businessId, version: v },
      data: { primaryColor: i.primary, accentColor: i.accent, version: { increment: 1 } },
    })
    if (r.count === 0) throw staleSettings()
    await audit(ctx, { action: 'brand.updated', targetType: 'business', targetId: ctx.businessId, metadata: { changes } }, tx)
  })
  return getBusinessAppearance(ctx)
}
