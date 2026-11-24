import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { createPlatformAdminContext } from '@/server/auth/context'
import { requireActiveAdmin } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import { Prisma } from '@/server/db/generated/client'
import { DomainError, orNotFound, parse, z, zodFields } from '@/server/domain/errors'
import { replaceBrandImage, type BrandImageSlot } from '@/server/domain/platform/brand-image'
import type { Modules } from '@/shared/modules'
import {
  applyNotificationSettings,
  getNotificationSettings,
  type NotificationSettings,
} from '@/server/domain/settings/notification-settings'
import {
  applySchedulingRules,
  getSchedulingRules,
  parseSchedulingRules,
  type SchedulingRules,
  type SchedulingRulesView,
} from '@/server/domain/settings/scheduling-rules'
import { displayNameSchema } from '@/server/domain/settings/text-rules'
import { uploadUrl } from '@/server/storage/images'
import { COVER_MATERIALS, type CoverMaterial } from '@/shared/theme/derive'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

export type BrandInput = {
  displayName: string
  primary: string
  accent: string
  material: CoverMaterial
}

export type BrandView = BrandInput & {
  logoUrl: string | null
  symbolUrl: string | null
  faviconUrl: string | null
  loginImageUrl: string | null
  version: number
}

export type { BrandImageSlot }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function exigirAdmin(actor: PlatformAdminActor): void {
  if (actor?.kind !== 'platform_admin') throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

function idValido(id: string): string {
  if (!UUID.test(id)) throw new DomainError('not_found', 'Conta não encontrada.')
  return id
}

function auditar(tx: Prisma.TransactionClient, actor: PlatformAdminActor, action: string, businessId: string, metadata: Prisma.InputJsonObject) {
  return tx.auditLog.create({
    data: {
      businessId,
      actorType: 'PLATFORM_ADMIN',
      actorId: actor.adminId,
      actorName: actor.name,
      onBehalf: false,
      action,
      targetType: 'business',
      targetId: businessId,
      metadata,
    },
  })
}

// ---------------------------------------------------------------- marca

// A coluna tem CHECK `^#[0-9A-F]{6}$` (maiúsculas): a forma canônica da cor é `#RRGGBB` em maiúsculas.

const MSG_COR = 'Use uma cor no formato #rrggbb, com 6 dígitos.'
const cor = z
  .string(MSG_COR)
  .regex(/^#[0-9a-fA-F]{6}$/, MSG_COR)
  .transform((v) => v.toUpperCase())


const marcaSchema = z.strictObject({
  displayName: displayNameSchema,
  primary: cor,
  accent: cor,
  material: z.enum(COVER_MATERIALS, { error: 'Escolha uma das barras laterais da lista.' }),
})

const SELECAO_MARCA = {
  displayName: true,
  primaryColor: true,
  accentColor: true,
  coverMaterial: true,
  version: true,
  logo: { select: { path: true } },
  symbol: { select: { path: true } },
  favicon: { select: { path: true } },
  loginImage: { select: { path: true } },
} satisfies Prisma.BusinessBrandingSelect

function paraMarca(b: Prisma.BusinessBrandingGetPayload<{ select: typeof SELECAO_MARCA }>): BrandView {
  return {
    displayName: b.displayName,
    primary: b.primaryColor,
    accent: b.accentColor,
    material: b.coverMaterial,
    logoUrl: uploadUrl(b.logo),
    symbolUrl: uploadUrl(b.symbol),
    faviconUrl: uploadUrl(b.favicon),
    loginImageUrl: uploadUrl(b.loginImage),
    version: b.version,
  }
}

async function lerMarca(businessId: string): Promise<BrandView> {
  const b = orNotFound(await prisma.businessBranding.findUnique({ where: { businessId }, select: SELECAO_MARCA }), 'Marca da conta')
  return paraMarca(b)
}

const CAMPOS_MARCA = [
  ['displayName', 'displayName'],
  ['primary', 'primaryColor'],
  ['accent', 'accentColor'],
  ['material', 'coverMaterial'],
] as const

/**
 * Grava a marca. O UPDATE é uma instrução só, condicionada à versão lida: quem grava sobre uma versão antiga recebe
 * `conflict` (`stale_version`). Sem mudança nenhuma, devolve a marca atual sem gravar, sem auditar e sem subir a versão.
 * A auditoria guarda `{ from, to }` só dos campos que mudaram.
 * As imagens têm o seu próprio caminho (`setBrandImage`) e não mexem na versão.
 */
export async function updateBrand(actor: PlatformAdminActor, businessId: string, version: number, input: BrandInput): Promise<BrandView> {
  exigirAdmin(actor)
  idValido(businessId)
  const v = parse(z.number().int().min(1), version)
  const i = parse(marcaSchema, input)
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    const atual = orNotFound(await tx.businessBranding.findUnique({ where: { businessId } }), 'Marca da conta')
    const changes: Record<string, { from: string; to: string }> = {}
    for (const [campo, coluna] of CAMPOS_MARCA) {
      if (atual[coluna] !== i[campo]) changes[campo] = { from: atual[coluna], to: i[campo] }
    }
    if (Object.keys(changes).length === 0) return
    // O nome de exibição também é do dono (Configurações > Negócio), cuja versão é a do negócio: quem leu antes recebe conflito.
    if (changes.displayName) await tx.business.update({ where: { id: businessId }, data: { version: { increment: 1 } } })
    const r = await tx.businessBranding.updateMany({
      where: { businessId, version: v },
      data: {
        displayName: i.displayName,
        primaryColor: i.primary,
        accentColor: i.accent,
        coverMaterial: i.material,
        version: { increment: 1 },
      },
    })
    if (r.count === 0) {
      throw new DomainError('conflict', 'Outra pessoa alterou a marca desta conta enquanto você editava. Recarregue a página e refaça a alteração.', {
        reason: 'stale_version',
      })
    }
    await auditar(tx, actor, 'brand.updated', businessId, { changes })
  })
  return lerMarca(businessId)
}

// ---------------------------------------------------------------- imagens

/** Troca (ou, com `file: null`, remove) uma imagem da marca; a gravação é a mesma que o dono usa para a logo. */
export async function setBrandImage(
  actor: PlatformAdminActor,
  businessId: string,
  slot: BrandImageSlot,
  file: { bytes: Uint8Array; mime: string } | null,
): Promise<BrandView> {
  exigirAdmin(actor)
  idValido(businessId)
  const ctx = await createPlatformAdminContext({ businessId, actor })
  await replaceBrandImage(ctx, slot, file)
  return lerMarca(businessId)
}

// ---------------------------------------------------------------- módulos

const modulosSchema = z.strictObject({
  loyalty: z.boolean('Informe ligado ou desligado.'),
  banners: z.boolean('Informe ligado ou desligado.'),
  store: z.boolean('Informe ligado ou desligado.'),
})

const MODULOS_PADRAO: Modules = { loyalty: false, banners: false, store: false }

export async function updateModules(actor: PlatformAdminActor, businessId: string, input: Modules): Promise<Modules> {
  exigirAdmin(actor)
  idValido(businessId)
  const i = parse(modulosSchema, input)
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    orNotFound(await tx.business.findUnique({ where: { id: businessId }, select: { id: true } }), 'Conta')
    const antes = (await tx.businessModules.findUnique({ where: { businessId }, select: { loyalty: true, banners: true, store: true } })) ?? MODULOS_PADRAO
    const mudou = (Object.keys(i) as (keyof Modules)[]).some((k) => i[k] !== antes[k])
    const depois = await tx.businessModules.upsert({
      where: { businessId },
      create: { businessId, ...i },
      update: mudou ? { ...i, version: { increment: 1 } } : i,
      select: { loyalty: true, banners: true, store: true },
    })
    await auditar(tx, actor, 'modules.updated', businessId, { from: antes, to: depois })
    return depois
  })
}

/**
 * Pré-validação da configuração de uma conta nova (marca, módulos e regras de agenda) com os MESMOS esquemas das
 * funções de escrita (`updateBrand`, `updateModules`, `updateRulesAsAdmin`). Devolve campo → mensagem de
 * todos os erros de uma vez, vazio se está tudo certo. Não grava nada: serve para recusar antes de criar a conta.
 */
export function validateAccountSetup(input: { brand: BrandInput; modules: Modules; rules: Partial<SchedulingRules> }): Record<string, string> {
  const erros: Record<string, string> = {}
  const marca = marcaSchema.safeParse(input.brand)
  if (!marca.success) Object.assign(erros, zodFields(marca.error, { perUnknownKey: true }))
  const modulos = modulosSchema.safeParse(input.modules)
  if (!modulos.success) Object.assign(erros, zodFields(modulos.error, { perUnknownKey: true }))
  try {
    parseSchedulingRules(input.rules)
  } catch (e) {
    if (!(e instanceof DomainError)) throw e
    Object.assign(erros, e.fields ?? {})
  }
  return erros
}

// ---------------------------------------------------------------- regras, fuso e avisos

/**
 * Regras de agenda (mesmo esquema de validação e mesma ação de auditoria do dono, com o admin como autor). O fuso é fixo
 * (`America/Sao_Paulo`) e não se altera aqui; o retorno traz o fuso gravado na conta.
 */
export async function updateRulesAsAdmin(
  actor: PlatformAdminActor,
  businessId: string,
  input: Partial<SchedulingRules>,
  version?: number,
): Promise<{ rules: SchedulingRulesView; timeZone: string }> {
  exigirAdmin(actor)
  idValido(businessId)
  const ctx = await createPlatformAdminContext({ businessId, actor })
  const regras = parseSchedulingRules(input)
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    // Mesma gravação do dono (`applySchedulingRules`).
    await applySchedulingRules(ctx, tx, regras, Object.keys(regras).length > 0 ? version : undefined)
  })
  const [rules, conta] = await Promise.all([
    getSchedulingRules(ctx),
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } }),
  ])
  return { rules, timeZone: conta.timezone }
}

export async function updateNotificationsAsAdmin(
  actor: PlatformAdminActor,
  businessId: string,
  input: NotificationSettings,
  version?: number,
): Promise<NotificationSettings> {
  exigirAdmin(actor)
  idValido(businessId)
  const ctx = await createPlatformAdminContext({ businessId, actor })
  return prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    return applyNotificationSettings(ctx, tx, input, version)
  })
}

// ---------------------------------------------------------------- leitura

export async function getCustomization(
  actor: PlatformAdminActor,
  businessId: string,
): Promise<{ brand: BrandView; modules: Modules; rules: SchedulingRulesView; timeZone: string; notifications: NotificationSettings }> {
  exigirAdmin(actor)
  idValido(businessId)
  const ctx = await createPlatformAdminContext({ businessId, actor })
  const [brand, modules, rules, notifications] = await Promise.all([
    lerMarca(businessId),
    prisma.businessModules.findUnique({ where: { businessId }, select: { loyalty: true, banners: true, store: true } }),
    getSchedulingRules(ctx),
    getNotificationSettings(ctx),
  ])
  return {
    brand,
    modules: modules ?? MODULOS_PADRAO,
    rules,
    timeZone: ctx.timeZone,
    notifications,
  }
}
