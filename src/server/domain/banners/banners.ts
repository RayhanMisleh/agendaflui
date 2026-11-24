import type { TenantContext } from '@/server/auth/actor'
import type { Banner, Prisma, Upload } from '@/server/db/generated/client'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { definedOnly } from '@/server/domain/input'
import { requireModule } from '@/server/domain/modules'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { compareLocalDates, dbDateToLocal, isLocalDate, localToDbDate, todayIn } from '@/server/time'
import { deleteUploadRecord, ImageError, publicUploadUrl, removeUploadFile, saveImage, uploadUrl } from '@/server/storage/images'

export type BannerInput = { title: string; linkUrl: string | null; startsOn: string | null; endsOn: string | null; active: boolean }

/** `live`: no ar hoje; `scheduled`: ativo, começa depois de hoje; `ended`: ativo, já passou do fim; `inactive`: desligado ou sem imagem. */
export type BannerStatus = 'live' | 'scheduled' | 'ended' | 'inactive'

export type BannerView = BannerInput & {
  id: string
  imageUrl: string | null
  displayOrder: number
  showingToday: boolean
  status: BannerStatus
}

type BannerRow = Banner & { image: Upload | null }

const MAX_LIVE = 20
const idSchema = z.uuid()
const withImage = { image: true } as const

const LINK_MESSAGE = 'Use um endereço que comece com https:// ou um caminho da loja, como /servicos'
const INTERNAL_ROUTE = /^\/[a-z0-9][a-z0-9/_-]*$/

function linkIsValid(link: string): boolean {
  if (link.startsWith('/')) return INTERNAL_ROUTE.test(link) && !link.includes('//')
  if (!/^https:\/\/[^\s]+$/i.test(link)) return false
  try {
    const url = new URL(link)
    return url.protocol === 'https:' && url.hostname !== ''
  } catch {
    return false
  }
}

/** Link do banner: vazio, `https://` com endereço, ou caminho interno da loja. Qualquer outro esquema é recusado. */
export const bannerLinkSchema: z.ZodType<string | null> = z
  .string(LINK_MESSAGE)
  .trim()
  .max(500, 'Use até 500 caracteres no link.')
  .nullable()
  .transform((v) => (v === '' ? null : v))
  .superRefine((v, ctx) => {
    if (v !== null && !linkIsValid(v)) ctx.addIssue({ code: 'custom', message: LINK_MESSAGE })
  })

const dateField = (nome: string) =>
  z
    .string(`Informe a data ${nome} ou deixe em branco.`)
    .trim()
    .nullable()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || isLocalDate(v), 'Informe uma data válida.')

const fields = {
  title: z.string('Informe o título do banner.').trim().min(1, 'Informe o título do banner.').max(80, 'Use até 80 caracteres no título.'),
  linkUrl: bannerLinkSchema,
  startsOn: dateField('de início'),
  endsOn: dateField('final'),
  active: z.boolean('Informe se o banner está ativo.'),
}

const createSchema = z.object(fields)
const updateSchema = z.object(fields).partial()

function fieldError(field: string, message: string): DomainError {
  return new DomainError('validation', message, { fields: { [field]: message } })
}

function checkPeriod(startsOn: string | null, endsOn: string | null): void {
  if (startsOn !== null && endsOn !== null && compareLocalDates(endsOn, startsOn) < 0) {
    throw fieldError('endsOn', 'A data final não pode ser antes da data de início.')
  }
}

const NEEDS_IMAGE = 'Envie a imagem antes de ativar o banner.'

function statusOf(row: BannerRow, today: string): BannerStatus {
  if (!row.active || row.imageUploadId === null) return 'inactive'
  if (row.endsOn !== null && compareLocalDates(dbDateToLocal(row.endsOn), today) < 0) return 'ended'
  if (row.startsOn !== null && compareLocalDates(dbDateToLocal(row.startsOn), today) > 0) return 'scheduled'
  return 'live'
}

function toView(ctx: TenantContext, row: BannerRow): BannerView {
  const status = statusOf(row, todayIn(ctx.timeZone, ctx.clock()))
  return {
    id: row.id,
    title: row.title,
    linkUrl: row.linkUrl,
    startsOn: row.startsOn === null ? null : dbDateToLocal(row.startsOn),
    endsOn: row.endsOn === null ? null : dbDateToLocal(row.endsOn),
    active: row.active,
    imageUrl: ctx.channel === 'app' ? publicUploadUrl(row.image) : uploadUrl(row.image),
    displayOrder: row.displayOrder,
    showingToday: status === 'live',
    status,
  }
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Banner não encontrado.')
}

async function loadRow(ctx: TenantContext, id: string): Promise<BannerRow> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await ctx.db.banner.findUnique({ where: { id }, include: withImage }), 'Banner')
}

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'banners')
  authorize(ctx, 'manage_banners')
}

export async function listBanners(ctx: TenantContext): Promise<BannerView[]> {
  await guard(ctx)
  const rows = await ctx.db.banner.findMany({ orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], include: withImage })
  return rows.map((r) => toView(ctx, r))
}

export async function getBanner(ctx: TenantContext, id: string): Promise<BannerView> {
  await guard(ctx)
  return toView(ctx, await loadRow(ctx, id))
}

/** Os banners no ar hoje (data local da conta, inclusive nas pontas), em ordem, até 20. Qualquer ator da conta, com o módulo ligado. */
export async function listLiveBanners(ctx: TenantContext): Promise<{ id: string; title: string; imageUrl: string; linkUrl: string | null }[]> {
  await requireModule(ctx, 'banners')
  const today = localToDbDate(todayIn(ctx.timeZone, ctx.clock()))
  const rows = await ctx.db.banner.findMany({
    where: {
      active: true,
      imageUploadId: { not: null },
      AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: today } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: today } }] }],
    },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    take: MAX_LIVE,
    include: withImage,
  })
  const live: { id: string; title: string; imageUrl: string; linkUrl: string | null }[] = []
  for (const row of rows) {
    const imageUrl = toView(ctx, row).imageUrl
    if (imageUrl !== null) live.push({ id: row.id, title: row.title, imageUrl, linkUrl: row.linkUrl })
  }
  return live
}

export async function createBanner(ctx: TenantContext, i: BannerInput): Promise<BannerView> {
  await guard(ctx)
  const input = parse(createSchema, i)
  checkPeriod(input.startsOn, input.endsOn)
  // O banner nasce sem imagem, e sem imagem não fica ativo.
  if (input.active) throw fieldError('active', NEEDS_IMAGE)
  const row = await ctx.db.$transaction(async (tx) => {
    // A ordem é da conta: dois banners criados juntos não ficam com a mesma posição.
    await tx.$lockKey('banners', ctx.businessId)
    const last = await tx.banner.aggregate({ _max: { displayOrder: true } })
    const created = await tx.banner.create({
      data: {
        businessId: ctx.businessId,
        title: input.title,
        linkUrl: input.linkUrl,
        startsOn: input.startsOn === null ? null : localToDbDate(input.startsOn),
        endsOn: input.endsOn === null ? null : localToDbDate(input.endsOn),
        active: false,
        displayOrder: (last._max.displayOrder ?? 0) + 1,
      },
      include: withImage,
    })
    await audit(ctx, { action: 'banner.created', targetType: 'Banner', targetId: created.id }, tx)
    return created
  }, TX_OPTIONS)
  return toView(ctx, row)
}

export async function updateBanner(ctx: TenantContext, id: string, i: Partial<BannerInput>): Promise<BannerView> {
  await guard(ctx)
  const changes = definedOnly(parse(updateSchema, i))
  const current = await loadRow(ctx, id)
  checkPeriod(
    changes.startsOn !== undefined ? changes.startsOn : current.startsOn === null ? null : dbDateToLocal(current.startsOn),
    changes.endsOn !== undefined ? changes.endsOn : current.endsOn === null ? null : dbDateToLocal(current.endsOn),
  )
  const { startsOn, endsOn, ...rest } = changes
  const data: Prisma.BannerUncheckedUpdateInput = {
    ...rest,
    ...(startsOn !== undefined ? { startsOn: startsOn === null ? null : localToDbDate(startsOn) } : {}),
    ...(endsOn !== undefined ? { endsOn: endsOn === null ? null : localToDbDate(endsOn) } : {}),
  }
  const row = await ctx.db.$transaction(async (tx) => {
    // Sob a mesma trava da troca de imagem: a conferência "precisa de imagem" lê o banner de agora, não o de antes.
    await tx.$lockKey('banners', ctx.businessId)
    if (changes.active === true) {
      const agora = orNotFound(await tx.banner.findUnique({ where: { id }, select: { imageUploadId: true } }), 'Banner')
      if (agora.imageUploadId === null) throw fieldError('active', NEEDS_IMAGE)
    }
    const updated = await tx.banner.update({ where: { id }, data, include: withImage })
    await audit(ctx, { action: 'banner.updated', targetType: 'Banner', targetId: id, metadata: { fields: Object.keys(changes).join(',') } }, tx)
    return updated
  }, TX_OPTIONS)
  return toView(ctx, row)
}

/** Sobe ou desce um banner na ordem, trocando de lugar com o vizinho. Nas pontas não faz nada. */
export async function moveBanner(ctx: TenantContext, id: string, direction: 'up' | 'down'): Promise<void> {
  await guard(ctx)
  await loadRow(ctx, id)
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('banners', ctx.businessId)
    const all = await tx.banner.findMany({ orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], select: { id: true, displayOrder: true } })
    const from = all.findIndex((b) => b.id === id)
    const to = direction === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= all.length) return
    const order = all.map((b) => b.id)
    const [moved] = order.splice(from, 1)
    if (moved === undefined) return
    order.splice(to, 0, moved)
    // Renumera a lista inteira: a ordem fica sem repetição mesmo se linhas antigas tiverem a mesma posição.
    for (const [index, bannerId] of order.entries()) {
      if (all.find((b) => b.id === bannerId)?.displayOrder !== index + 1) {
        await tx.banner.update({ where: { id: bannerId }, data: { displayOrder: index + 1 } })
      }
    }
    await audit(ctx, { action: 'banner.moved', targetType: 'Banner', targetId: id, metadata: { direction } }, tx)
  }, TX_OPTIONS)
}

function fileAuthor(ctx: TenantContext): { type: 'USER' | 'PLATFORM_ADMIN'; id: string | null } {
  const actor = ctx.actor
  if (actor.kind === 'member') return { type: 'USER', id: actor.userId }
  if (actor.kind === 'impersonator' || actor.kind === 'platform_admin') return { type: 'PLATFORM_ADMIN', id: actor.adminId }
  throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

/**
 * Troca (ou, com `file: null`, remove) a imagem do banner. Grava a nova, liga ao banner numa transação e só depois apaga a
 * antiga; se a ligação falhar, a nova é desfeita. Tirar a imagem de um banner ativo também o desativa (sem imagem ele não vai ao ar).
 */
export async function setBannerImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<BannerView> {
  await guard(ctx)
  await loadRow(ctx, id)
  const author = fileAuthor(ctx)
  let created: { id: string; path: string } | null = null
  if (file !== null) {
    try {
      created = await saveImage({ businessId: ctx.businessId, data: Buffer.from(file.bytes), purpose: 'banner', createdBy: author })
    } catch (e) {
      if (e instanceof ImageError) throw new DomainError('validation', e.message, { fields: { file: e.message }, details: { imageCode: e.code } })
      throw e
    }
  }
  let previous: string | null = null
  let row: BannerRow
  try {
    ;({ row, previous } = await ctx.db.$transaction(async (tx: TenantTx) => {
      await tx.$lockKey('banners', ctx.businessId)
      const atual = orNotFound(await tx.banner.findUnique({ where: { id }, select: { imageUploadId: true } }), 'Banner')
      const updated = await tx.banner.update({
        where: { id },
        data: { imageUploadId: created?.id ?? null, ...(created === null ? { active: false } : {}) },
        include: withImage,
      })
      await audit(
        ctx,
        { action: 'banner.image_changed', targetType: 'Banner', targetId: id, metadata: { change: created === null ? 'removed' : atual.imageUploadId === null ? 'added' : 'replaced' } },
        tx,
      )
      return { row: updated, previous: atual.imageUploadId }
    }, TX_OPTIONS))
  } catch (e) {
    if (created) {
      const path = await deleteUploadRecord(ctx.db, created.id).catch(() => null)
      if (path) await removeUploadFile(path)
    }
    throw e
  }
  if (previous !== null && previous !== created?.id) {
    const path = await deleteUploadRecord(ctx.db, previous)
    if (path !== null) await removeUploadFile(path)
  }
  return toView(ctx, row)
}

/** Banner não tem histórico: excluir apaga a linha, o registro da imagem e o arquivo. */
export async function deleteBanner(ctx: TenantContext, id: string): Promise<void> {
  await guard(ctx)
  await loadRow(ctx, id)
  const path = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('banners', ctx.businessId)
    // Relê sob a trava: uma troca de imagem concorrente muda `imageUploadId` e não pode deixar arquivo órfão.
    const current = await tx.banner.findUnique({ where: { id }, select: { imageUploadId: true, title: true } })
    if (current === null) return null
    await tx.banner.delete({ where: { id } })
    const filePath = current.imageUploadId === null ? null : await deleteUploadRecord(tx, current.imageUploadId)
    await audit(ctx, { action: 'banner.deleted', targetType: 'Banner', targetId: id, metadata: { title: current.title } }, tx)
    return filePath
  }, TX_OPTIONS)
  if (path !== null) await removeUploadFile(path)
}
