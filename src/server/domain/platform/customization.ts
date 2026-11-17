import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { createPlatformAdminContext } from '@/server/auth/context'
import { prisma } from '@/server/db/client'
import { Prisma } from '@/server/db/generated/client'
import { DomainError, orNotFound, parse, z, zodFields } from '@/server/domain/errors'
import type { Modules } from '@/server/domain/platform/businesses'
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings,
} from '@/server/domain/settings/notification-settings'
import { getSchedulingRules, parseSchedulingRules, type SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { ImageError, removeUploadFile, saveImage, uploadUrl, type ImagePurpose } from '@/server/storage/images'
import { canonicalTimeZone } from '@/server/time'
import { COVER_MATERIALS, FONT_PAIRS, PAPER_TONES, type CoverMaterial, type FontPair, type PaperTone } from '@/shared/theme/derive'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

export type Terms = {
  professionalSingular: string
  professionalPlural: string
  customerSingular: string
  customerPlural: string
  pointsSingular: string
  pointsPlural: string
  club: string
}

export type BrandInput = {
  displayName: string
  primary: string
  accent: string
  material: CoverMaterial
  paper: PaperTone
  fontPair: FontPair
  loginMessage: string | null
}

export type BrandView = BrandInput & {
  logoUrl: string | null
  symbolUrl: string | null
  faviconUrl: string | null
  loginImageUrl: string | null
  version: number
}

export type BrandImageSlot = 'logo' | 'symbol' | 'favicon' | 'loginImage'

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

const MSG_MARCACAO = 'Não use os sinais < e >.'
const MSG_CONTROLE = 'Não use caracteres de controle (como quebra de linha ou tabulação).'
// \p{C}: controle, formato (como o espaço de largura zero), surrogates soltos e não atribuídos.
const SEM_CONTROLE = (v: string) => !/\p{C}/u.test(v)
const SEM_MARCACAO = (v: string) => !/[<>]/.test(v)
// Na mensagem de entrada a quebra de linha vale; qualquer outro caractere de controle não.
const SEM_CONTROLE_EXCETO_LINHA = (v: string) => !/[^\P{C}\r\n]/u.test(v)

const marcaSchema = z.strictObject({
  displayName: z
    .string('Informe o nome de exibição.')
    .trim()
    .min(1, 'Informe o nome de exibição.')
    .max(80, 'Use no máximo 80 caracteres.')
    .refine(SEM_MARCACAO, MSG_MARCACAO)
    .refine(SEM_CONTROLE, MSG_CONTROLE),
  primary: cor,
  accent: cor,
  material: z.enum(COVER_MATERIALS, { error: 'Escolha um dos materiais da lista.' }),
  paper: z.enum(PAPER_TONES, { error: 'Escolha um dos tons de papel da lista.' }),
  fontPair: z.enum(FONT_PAIRS, { error: 'Escolha um dos pares de fontes da lista.' }),
  loginMessage: z
    .string()
    .trim()
    .max(280, 'Use no máximo 280 caracteres.')
    .refine(SEM_MARCACAO, MSG_MARCACAO)
    .refine(SEM_CONTROLE_EXCETO_LINHA, MSG_CONTROLE)
    .transform((v) => (v === '' ? null : v))
    .nullable(),
})

const SELECAO_MARCA = {
  displayName: true,
  primaryColor: true,
  accentColor: true,
  coverMaterial: true,
  paperTone: true,
  fontPair: true,
  loginMessage: true,
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
    paper: b.paperTone,
    fontPair: b.fontPair,
    loginMessage: b.loginMessage,
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
  ['paper', 'paperTone'],
  ['fontPair', 'fontPair'],
] as const

/**
 * Grava a marca. O UPDATE é uma instrução só, condicionada à versão lida: quem grava sobre uma versão antiga recebe
 * `conflict` (`stale_version`). Sem mudança nenhuma, devolve a marca atual sem gravar, sem auditar e sem subir a versão.
 * A auditoria guarda `{ from, to }` só dos campos que mudaram; da mensagem de entrada, só que mudou (não o texto).
 * As imagens têm o seu próprio caminho (`setBrandImage`) e não mexem na versão.
 */
export async function updateBrand(actor: PlatformAdminActor, businessId: string, version: number, input: BrandInput): Promise<BrandView> {
  exigirAdmin(actor)
  idValido(businessId)
  const v = parse(z.number().int().min(1), version)
  const i = parse(marcaSchema, input)
  await prisma.$transaction(async (tx) => {
    const atual = orNotFound(await tx.businessBranding.findUnique({ where: { businessId } }), 'Marca da conta')
    const changes: Record<string, { from: string; to: string }> = {}
    for (const [campo, coluna] of CAMPOS_MARCA) {
      if (atual[coluna] !== i[campo]) changes[campo] = { from: atual[coluna], to: i[campo] }
    }
    const mensagemMudou = atual.loginMessage !== i.loginMessage
    if (Object.keys(changes).length === 0 && !mensagemMudou) return
    const r = await tx.businessBranding.updateMany({
      where: { businessId, version: v },
      data: {
        displayName: i.displayName,
        primaryColor: i.primary,
        accentColor: i.accent,
        coverMaterial: i.material,
        paperTone: i.paper,
        fontPair: i.fontPair,
        loginMessage: i.loginMessage,
        version: { increment: 1 },
      },
    })
    if (r.count === 0) {
      throw new DomainError('conflict', 'Outra pessoa alterou a marca desta conta enquanto você editava. Recarregue a página e refaça a alteração.', {
        reason: 'stale_version',
      })
    }
    await auditar(tx, actor, 'brand.updated', businessId, { changes, ...(mensagemMudou ? { loginMessageChanged: true } : {}) })
  })
  return lerMarca(businessId)
}

// ---------------------------------------------------------------- imagens

const SLOTS: Record<BrandImageSlot, { purpose: ImagePurpose; coluna: Prisma.Sql; campo: 'logoUploadId' | 'symbolUploadId' | 'faviconUploadId' | 'loginImageUploadId' }> = {
  logo: { purpose: 'logo', coluna: Prisma.raw('logo_upload_id'), campo: 'logoUploadId' },
  symbol: { purpose: 'symbol', coluna: Prisma.raw('symbol_upload_id'), campo: 'symbolUploadId' },
  favicon: { purpose: 'favicon', coluna: Prisma.raw('favicon_upload_id'), campo: 'faviconUploadId' },
  loginImage: { purpose: 'login', coluna: Prisma.raw('login_image_upload_id'), campo: 'loginImageUploadId' },
}

function erroDeImagem(slot: string, e: ImageError): DomainError {
  // `imageCode` deixa a tela dizer o motivo sem depender do texto da mensagem.
  return new DomainError('validation', e.message, { fields: { [slot]: e.message }, details: { imageCode: e.code } })
}

/** Remove o arquivo e o registro de uma imagem que saiu do ar. Falha vira log (sem texto do erro) e não desfaz nada. */
async function apagarImagem(businessId: string, slot: string, uploadId: string): Promise<void> {
  try {
    const up = await prisma.upload.findUnique({ where: { id: uploadId }, select: { path: true } })
    if (!up) return
    const { fileRemoved } = await removeUploadFile(up.path)
    // Arquivo que não saiu fica com o registro (sem vínculo), para a limpeza achar depois.
    if (fileRemoved) await prisma.upload.deleteMany({ where: { id: uploadId } })
    else console.error(JSON.stringify({ level: 'error', event: 'brand_image_cleanup_failed', businessId, slot, uploadId }))
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'brand_image_cleanup_failed', businessId, slot, uploadId }))
  }
}

/**
 * Troca (ou, com `file: null`, remove) uma imagem da marca. Ordem: grava a nova, vincula na transação (com a linha da
 * marca travada, para duas trocas seguidas não deixarem imagem sem vínculo) e só depois apaga a antiga. O tipo vem dos
 * bytes, nunca do `mime` declarado. Se o vínculo falhar, a imagem nova é desfeita.
 */
export async function setBrandImage(
  actor: PlatformAdminActor,
  businessId: string,
  slot: BrandImageSlot,
  file: { bytes: Uint8Array; mime: string } | null,
): Promise<BrandView> {
  exigirAdmin(actor)
  idValido(businessId)
  // `hasOwn`: 'constructor' e '__proto__' existem em todo objeto e não são espaços.
  const s = Object.hasOwn(SLOTS, slot) ? SLOTS[slot] : undefined
  if (!s) throw new DomainError('validation', 'Escolha onde a imagem vai: logo, símbolo, favicon ou imagem de entrada.', { fields: { slot: 'Espaço de imagem desconhecido.' } })

  orNotFound(await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }), 'Conta')
  let nova: { id: string; path: string } | null = null
  if (file !== null) {
    try {
      nova = await saveImage({ businessId, data: Buffer.from(file.bytes), purpose: s.purpose, createdBy: { type: 'PLATFORM_ADMIN', id: actor.adminId } })
    } catch (e) {
      if (e instanceof ImageError) throw erroDeImagem(slot, e)
      throw e
    }
  }
  let antiga: string | null
  try {
    antiga = await prisma.$transaction(async (tx) => {
      const linhas = await tx.$queryRaw<{ antiga: string | null }[]>(
        Prisma.sql`SELECT ${s.coluna} AS antiga FROM business_branding WHERE business_id = ${businessId}::uuid FOR UPDATE`,
      )
      const linha = linhas[0]
      if (!linha) throw new DomainError('not_found', 'Marca da conta não encontrada.')
      await tx.businessBranding.update({ where: { businessId }, data: { [s.campo]: nova?.id ?? null } })
      if (nova !== null || linha.antiga !== null) {
        await auditar(tx, actor, 'brand.image_changed', businessId, {
          slot,
          change: nova === null ? 'removed' : linha.antiga === null ? 'added' : 'replaced',
        })
      }
      return linha.antiga
    })
  } catch (e) {
    if (nova) await apagarImagem(businessId, slot, nova.id)
    throw e
  }
  if (antiga !== null) await apagarImagem(businessId, slot, antiga)
  return lerMarca(businessId)
}

// ---------------------------------------------------------------- termos

const termo = z
  .string('Informe o termo.')
  .trim()
  .min(1, 'Informe o termo.')
  .max(30, 'Use no máximo 30 caracteres.')
  .refine(SEM_MARCACAO, MSG_MARCACAO)
  .refine(SEM_CONTROLE, MSG_CONTROLE)

const termosSchema = z.strictObject({
  professionalSingular: termo,
  professionalPlural: termo,
  customerSingular: termo,
  customerPlural: termo,
  pointsSingular: termo,
  pointsPlural: termo,
  club: termo,
})

function termosDe(s: {
  termProfessionalSingular: string
  termProfessionalPlural: string
  termCustomerSingular: string
  termCustomerPlural: string
  termPointsSingular: string
  termPointsPlural: string
  termClub: string
}): Terms {
  return {
    professionalSingular: s.termProfessionalSingular,
    professionalPlural: s.termProfessionalPlural,
    customerSingular: s.termCustomerSingular,
    customerPlural: s.termCustomerPlural,
    pointsSingular: s.termPointsSingular,
    pointsPlural: s.termPointsPlural,
    club: s.termClub,
  }
}

const SELECAO_TERMOS = {
  termProfessionalSingular: true,
  termProfessionalPlural: true,
  termCustomerSingular: true,
  termCustomerPlural: true,
  termPointsSingular: true,
  termPointsPlural: true,
  termClub: true,
} satisfies Prisma.BusinessSettingsSelect

export async function updateTerms(actor: PlatformAdminActor, businessId: string, input: Terms): Promise<Terms> {
  exigirAdmin(actor)
  idValido(businessId)
  const i = parse(termosSchema, input)
  return prisma.$transaction(async (tx) => {
    const antes = termosDe(orNotFound(await tx.businessSettings.findUnique({ where: { businessId }, select: SELECAO_TERMOS }), 'Configurações da conta'))
    const campos = (Object.keys(i) as (keyof Terms)[]).filter((k) => i[k] !== antes[k])
    if (campos.length === 0) return antes
    const depois = await tx.businessSettings.update({
      where: { businessId },
      data: {
        termProfessionalSingular: i.professionalSingular,
        termProfessionalPlural: i.professionalPlural,
        termCustomerSingular: i.customerSingular,
        termCustomerPlural: i.customerPlural,
        termPointsSingular: i.pointsSingular,
        termPointsPlural: i.pointsPlural,
        termClub: i.club,
      },
      select: SELECAO_TERMOS,
    })
    await auditar(tx, actor, 'terms.updated', businessId, {
      changes: Object.fromEntries(campos.map((k) => [k, { from: antes[k], to: i[k] }])),
    })
    return termosDe(depois)
  })
}

// ---------------------------------------------------------------- módulos

const modulosSchema = z.strictObject({
  loyalty: z.boolean('Informe ligado ou desligado.'),
  banners: z.boolean('Informe ligado ou desligado.'),
  store: z.boolean('Informe ligado ou desligado.'),
  vouchers: z.boolean('Informe ligado ou desligado.'),
})

const MODULOS_PADRAO: Modules = { loyalty: false, banners: false, store: false, vouchers: false }

const MSG_VOUCHERS = 'Vouchers exigem a Loja ligada, porque são vendidos como produto. Ligue a Loja ou desligue Vouchers.'

/** Vouchers são vendidos dentro de um pedido da Loja: um não vive sem o outro. */
export async function updateModules(actor: PlatformAdminActor, businessId: string, input: Modules): Promise<Modules> {
  exigirAdmin(actor)
  idValido(businessId)
  const i = parse(modulosSchema, input)
  if (i.vouchers && !i.store) {
    throw new DomainError('validation', MSG_VOUCHERS, { fields: { vouchers: MSG_VOUCHERS, store: MSG_VOUCHERS } })
  }
  return prisma.$transaction(async (tx) => {
    orNotFound(await tx.business.findUnique({ where: { id: businessId }, select: { id: true } }), 'Conta')
    const antes = (await tx.businessModules.findUnique({ where: { businessId }, select: { loyalty: true, banners: true, store: true, vouchers: true } })) ?? MODULOS_PADRAO
    const depois = await tx.businessModules.upsert({
      where: { businessId },
      create: { businessId, ...i },
      update: i,
      select: { loyalty: true, banners: true, store: true, vouchers: true },
    })
    await auditar(tx, actor, 'modules.updated', businessId, { from: antes, to: depois })
    return depois
  })
}

/**
 * Pré-validação da configuração de uma conta nova (marca, termos, módulos e regras de agenda) com os MESMOS esquemas das
 * funções de escrita (`updateBrand`, `updateTerms`, `updateModules`, `updateRulesAsAdmin`). Devolve campo → mensagem de
 * todos os erros de uma vez, vazio se está tudo certo. Não grava nada: serve para recusar antes de criar a conta.
 */
export function validateAccountSetup(input: { brand: BrandInput; terms: Terms; modules: Modules; rules: Partial<SchedulingRules> }): Record<string, string> {
  const erros: Record<string, string> = {}
  const marca = marcaSchema.safeParse(input.brand)
  if (!marca.success) Object.assign(erros, zodFields(marca.error, { perUnknownKey: true }))
  const termos = termosSchema.safeParse(input.terms)
  if (!termos.success) Object.assign(erros, zodFields(termos.error, { perUnknownKey: true }))
  const modulos = modulosSchema.safeParse(input.modules)
  if (!modulos.success) Object.assign(erros, zodFields(modulos.error, { perUnknownKey: true }))
  else if (modulos.data.vouchers && !modulos.data.store) Object.assign(erros, { vouchers: MSG_VOUCHERS, store: MSG_VOUCHERS })
  try {
    parseSchedulingRules(input.rules)
  } catch (e) {
    if (!(e instanceof DomainError)) throw e
    Object.assign(erros, e.fields ?? {})
  }
  return erros
}

// ---------------------------------------------------------------- regras, fuso e avisos

/** Fuso em forma canônica, ou `validation` com o campo `timeZone`. */
function fusoCanonico(valor: string): string {
  try {
    return canonicalTimeZone(valor)
  } catch (e) {
    const msg = e instanceof DomainError ? e.message : 'Informe um fuso horário válido.'
    throw new DomainError('validation', msg, { fields: { timeZone: msg } })
  }
}

/**
 * Regras de agenda (mesmo esquema de validação e mesma ação de auditoria do dono, com o admin como autor) e fuso, numa
 * transação só: tudo ou nada. Trocar o fuso não mexe nos agendamentos: os instantes ficam os mesmos e os rótulos locais
 * passam a ser calculados no fuso novo. A auditoria do fuso guarda o de antes e o de depois.
 */
export async function updateRulesAsAdmin(
  actor: PlatformAdminActor,
  businessId: string,
  input: Partial<SchedulingRules> & { timeZone?: string },
): Promise<{ rules: SchedulingRules; timeZone: string }> {
  exigirAdmin(actor)
  idValido(businessId)
  const { timeZone, ...pedido } = input
  const novoFuso = timeZone === undefined ? undefined : fusoCanonico(timeZone)
  const ctx = await createPlatformAdminContext({ businessId, actor })
  const regras = parseSchedulingRules(pedido)
  const campos = Object.keys(regras)
  await prisma.$transaction(async (tx) => {
    if (campos.length > 0) {
      const r = await tx.businessSettings.updateMany({ where: { businessId }, data: regras })
      if (r.count === 0) throw new DomainError('not_found', 'Configurações da conta não encontrado.')
      await tx.auditLog.create({
        data: {
          businessId,
          actorType: 'PLATFORM_ADMIN',
          actorId: actor.adminId,
          actorName: actor.name,
          onBehalf: false,
          action: 'scheduling_rules.updated',
          targetType: 'BusinessSettings',
          targetId: businessId,
          metadata: { fields: campos },
        },
      })
    }
    if (novoFuso !== undefined) {
      const conta = orNotFound(await tx.business.findUnique({ where: { id: businessId }, select: { timezone: true } }), 'Conta')
      if (conta.timezone !== novoFuso) {
        await tx.business.update({ where: { id: businessId }, data: { timezone: novoFuso } })
        await auditar(tx, actor, 'business.timezone_changed', businessId, { from: conta.timezone, to: novoFuso })
      }
    }
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
): Promise<NotificationSettings> {
  exigirAdmin(actor)
  idValido(businessId)
  const ctx = await createPlatformAdminContext({ businessId, actor })
  return updateNotificationSettings(ctx, input)
}

// ---------------------------------------------------------------- leitura

export async function getCustomization(
  actor: PlatformAdminActor,
  businessId: string,
): Promise<{ brand: BrandView; terms: Terms; modules: Modules; rules: SchedulingRules; timeZone: string; notifications: NotificationSettings }> {
  exigirAdmin(actor)
  idValido(businessId)
  const ctx = await createPlatformAdminContext({ businessId, actor })
  const [brand, settings, modules, rules, notifications] = await Promise.all([
    lerMarca(businessId),
    prisma.businessSettings.findUnique({ where: { businessId }, select: SELECAO_TERMOS }),
    prisma.businessModules.findUnique({ where: { businessId }, select: { loyalty: true, banners: true, store: true, vouchers: true } }),
    getSchedulingRules(ctx),
    getNotificationSettings(ctx),
  ])
  return {
    brand,
    terms: termosDe(orNotFound(settings, 'Configurações da conta')),
    modules: modules ?? MODULOS_PADRAO,
    rules,
    timeZone: ctx.timeZone,
    notifications,
  }
}
