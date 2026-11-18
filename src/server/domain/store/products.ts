import type { TenantContext } from '@/server/auth/actor'
import type { Prisma, Product, ProductImage, Upload } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { definedOnly } from '@/server/domain/input'
import { requireModule } from '@/server/domain/modules'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { deleteUploadRecord, ImageError, publicUploadUrl, removeUploadFile, saveImage, uploadUrl } from '@/server/storage/images'

export type ProductInput = {
  categoryId: string | null
  name: string
  description: string | null
  priceCents: number
  promoPriceCents: number | null
  stock: number
  weightGrams: number | null
  lengthCm: number | null
  heightCm: number | null
  widthCm: number | null
  active: boolean
}

export type ProductView = ProductInput & {
  id: string
  finalPriceCents: number
  images: { id: string; url: string }[]
  displayOrder: number
  archivedAt: Date | null
}

export type PublicProduct = {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  priceCents: number
  promoPriceCents: number | null
  finalPriceCents: number
  available: boolean
  maxQuantity: number
  images: { url: string }[]
}

type ProductRow = Product & { images: (ProductImage & { upload: Upload })[] }

export const MAX_STOCK = 100_000
export const MAX_PER_ORDER_LINE = 99
export const MAX_IMAGES = 6
const MAX_PRICE_CENTS = 100_000_000
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const PUBLIC_DEFAULT_LIMIT = 20
const PUBLIC_MAX_LIMIT = 50

const idSchema = z.uuid()
const withImages = { images: { orderBy: { position: 'asc' }, include: { upload: true } } } as const satisfies Prisma.ProductInclude

const cents = (nome: string) =>
  z
    .number(`Informe ${nome} em reais.`)
    .int(`Informe ${nome} em centavos inteiros.`)
    .min(1, `${nome[0]?.toUpperCase() ?? ''}${nome.slice(1)} precisa ser maior que zero.`)
    .max(MAX_PRICE_CENTS, `${nome[0]?.toUpperCase() ?? ''}${nome.slice(1)} é alto demais.`)

const dimension = (nome: string, max: number, unidade: string, limite: string) =>
  z
    .number(`Informe ${nome} em ${unidade} ou deixe em branco.`)
    .int(`Informe ${nome} em ${unidade} inteiros.`)
    .min(1, `${nome[0]?.toUpperCase() ?? ''}${nome.slice(1)} precisa ser de pelo menos 1 ${unidade === 'gramas' ? 'g' : 'cm'}.`)
    .max(max, `${nome[0]?.toUpperCase() ?? ''}${nome.slice(1)} pode ser de no máximo ${limite}.`)
    .nullable()

const stockField = z
  .number('Informe o estoque.')
  .int('Informe um número inteiro de unidades.')
  .min(0, 'O estoque não pode ser negativo.')
  .max(MAX_STOCK, 'O estoque máximo é de 100.000 unidades.')

const fields = {
  categoryId: z.uuid('Escolha uma categoria da lista.').nullable(),
  name: z.string('Informe o nome do produto.').trim().min(1, 'Informe o nome do produto.').max(120, 'Use até 120 caracteres no nome.'),
  description: z
    .string()
    .trim()
    .max(1000, 'Use até 1.000 caracteres na descrição.')
    .transform((t) => (t === '' ? null : t))
    .nullable(),
  priceCents: cents('o preço'),
  promoPriceCents: cents('o preço promocional').nullable(),
  stock: stockField,
  weightGrams: dimension('o peso', 30_000, 'gramas', '30.000 g (30 kg)'),
  lengthCm: dimension('o comprimento', 200, 'centímetros', '200 cm'),
  heightCm: dimension('a altura', 200, 'centímetros', '200 cm'),
  widthCm: dimension('a largura', 200, 'centímetros', '200 cm'),
  active: z.boolean('Informe se o produto está à venda.'),
}

const PROMO_MESSAGE = 'O preço promocional precisa ser menor que o preço.'

const createSchema = z.object(fields).superRefine((v, c) => {
  if (v.promoPriceCents !== null && v.promoPriceCents >= v.priceCents) c.addIssue({ code: 'custom', path: ['promoPriceCents'], message: PROMO_MESSAGE })
})
const updateSchema = z.object({ ...fields, expectedStock: stockField }).partial()

const adjustSchema = z.object({
  delta: z
    .number('Informe a quantidade, com sinal: 5 para entrada, -3 para saída.')
    .int('Informe um número inteiro de unidades.')
    .refine((v) => v !== 0, 'Informe uma quantidade diferente de zero.')
    .refine((v) => Math.abs(v) < MAX_STOCK, 'Use menos de 100.000 unidades por ajuste.'),
  reason: z.string('Informe o motivo do ajuste.').trim().min(3, 'Explique o motivo com pelo menos 3 caracteres.').max(200, 'Use até 200 caracteres no motivo.'),
})

const listSchema = z.object({
  categoryId: z.uuid('Escolha uma categoria válida.').optional(),
  search: z.string().trim().max(100, 'Use até 100 caracteres na busca.').optional(),
  cursor: z.string().max(1024).optional(),
})

const limitSchema = (max: number) =>
  z.number().int('Informe o limite como número inteiro.').min(1, 'O limite mínimo é 1.').max(max, `O limite máximo é ${max}.`).optional()

const notFound = (): DomainError => new DomainError('not_found', 'Produto não encontrado.')
const fieldError = (field: string, message: string): DomainError => new DomainError('validation', message, { fields: { [field]: message } })

function toView(ctx: TenantContext, row: ProductRow): ProductView {
  const url = ctx.channel === 'app' ? publicUploadUrl : uploadUrl
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    promoPriceCents: row.promoPriceCents,
    finalPriceCents: row.promoPriceCents ?? row.priceCents,
    stock: row.stock,
    weightGrams: row.weightGrams,
    lengthCm: row.lengthCm,
    heightCm: row.heightCm,
    widthCm: row.widthCm,
    active: row.active,
    images: row.images.flatMap((i) => {
      const u = url(i.upload)
      return u === null ? [] : [{ id: i.id, url: u }]
    }),
    displayOrder: row.displayOrder,
    archivedAt: row.archivedAt,
  }
}

function toPublic(ctx: TenantContext, row: ProductRow): PublicProduct {
  const v = toView(ctx, row)
  return {
    id: v.id,
    categoryId: v.categoryId,
    name: v.name,
    description: v.description,
    priceCents: v.priceCents,
    promoPriceCents: v.promoPriceCents,
    finalPriceCents: v.finalPriceCents,
    available: v.stock > 0,
    maxQuantity: Math.min(v.stock, MAX_PER_ORDER_LINE),
    images: v.images.map((i) => ({ url: i.url })),
  }
}

async function loadRow(ctx: TenantContext, id: string): Promise<ProductRow> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await ctx.db.product.findUnique({ where: { id }, include: withImages }), 'Produto')
}

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'store')
  authorize(ctx, 'manage_store')
}

/** O que o app enxerga: ativo, não arquivado e de categoria não arquivada (ou sem categoria). */
export const PUBLIC_PRODUCT_FILTER: Prisma.ProductWhereInput = { active: true, archivedAt: null, OR: [{ categoryId: null }, { category: { archivedAt: null } }] }

function encodeCursor(row: { displayOrder: number; id: string }): string {
  return Buffer.from(JSON.stringify([row.displayOrder, row.id])).toString('base64url')
}

function decodeCursor(cursor: string): { displayOrder: number; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isSafeInteger(parsed[0]) && typeof parsed[1] === 'string' && idSchema.safeParse(parsed[1]).success) {
      return { displayOrder: parsed[0] as number, id: parsed[1] }
    }
  } catch {
    // cai no erro abaixo
  }
  throw new DomainError('validation', 'O cursor de paginação é inválido. Recarregue a lista.', { fields: { cursor: 'Cursor inválido.' } })
}

async function page(
  ctx: TenantContext,
  base: Prisma.ProductWhereInput,
  q: { categoryId?: string | undefined; search?: string | undefined; cursor?: string | undefined; limit: number },
): Promise<{ rows: ProductRow[]; nextCursor: string | null }> {
  const after = q.cursor === undefined ? null : decodeCursor(q.cursor)
  const where: Prisma.ProductWhereInput = {
    AND: [
      base,
      ...(q.categoryId !== undefined ? [{ categoryId: q.categoryId }] : []),
      ...(q.search !== undefined && q.search !== '' ? [{ name: { contains: q.search, mode: 'insensitive' as const } }] : []),
      ...(after ? [{ OR: [{ displayOrder: { gt: after.displayOrder } }, { displayOrder: after.displayOrder, id: { gt: after.id } }] }] : []),
    ],
  }
  const rows = await ctx.db.product.findMany({ where, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], include: withImages, take: q.limit + 1 })
  const slice = rows.slice(0, q.limit)
  const last = slice[slice.length - 1]
  return { rows: slice, nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null }
}

/** Lista da equipe (`manage_store`): por padrão os não arquivados; filtra por situação, categoria e busca no nome. */
export async function listProducts(
  ctx: TenantContext,
  q: { categoryId?: string; search?: string; situation?: 'active' | 'inactive' | 'archived'; cursor?: string; limit?: number } = {},
): Promise<{ items: ProductView[]; nextCursor: string | null }> {
  await guard(ctx)
  const { situation } = q
  if (situation !== undefined && !['active', 'inactive', 'archived'].includes(situation)) throw fieldError('situation', 'Escolha uma situação válida.')
  const f = parse(listSchema, { categoryId: q.categoryId, search: q.search, cursor: q.cursor })
  const limit = parse(limitSchema(MAX_LIMIT), q.limit) ?? DEFAULT_LIMIT
  const base: Prisma.ProductWhereInput =
    situation === 'archived' ? { archivedAt: { not: null } } : situation === 'active' ? { archivedAt: null, active: true } : situation === 'inactive' ? { archivedAt: null, active: false } : { archivedAt: null }
  const { rows, nextCursor } = await page(ctx, base, { ...f, limit })
  return { items: rows.map((r) => toView(ctx, r)), nextCursor }
}

/** Catálogo do app (cliente e visitante): só o que está à venda, sem estoque nem dado interno. */
export async function listPublicProducts(
  ctx: TenantContext,
  q: { categoryId?: string; search?: string; cursor?: string; limit?: number } = {},
): Promise<{ items: PublicProduct[]; nextCursor: string | null }> {
  await requireModule(ctx, 'store')
  const f = parse(listSchema, { categoryId: q.categoryId, search: q.search, cursor: q.cursor })
  const limit = parse(limitSchema(PUBLIC_MAX_LIMIT), q.limit) ?? PUBLIC_DEFAULT_LIMIT
  const { rows, nextCursor } = await page(ctx, PUBLIC_PRODUCT_FILTER, { ...f, limit })
  return { items: rows.map((r) => toPublic(ctx, r)), nextCursor }
}

export async function getProduct(ctx: TenantContext, id: string): Promise<ProductView> {
  await guard(ctx)
  return toView(ctx, await loadRow(ctx, id))
}

export async function getPublicProduct(ctx: TenantContext, id: string): Promise<PublicProduct> {
  await requireModule(ctx, 'store')
  if (!idSchema.safeParse(id).success) throw notFound()
  const row = await ctx.db.product.findFirst({ where: { AND: [{ id }, PUBLIC_PRODUCT_FILTER] }, include: withImages })
  if (row === null) throw notFound()
  return toPublic(ctx, row)
}

async function assertCategory(ctx: TenantContext, categoryId: string | null | undefined, db: TenantContext['db'] = ctx.db): Promise<void> {
  if (categoryId === null || categoryId === undefined) return
  const found = await db.productCategory.findFirst({ where: { id: categoryId, archivedAt: null }, select: { id: true } })
  if (found === null) throw fieldError('categoryId', 'Escolha uma categoria da lista.')
}

export async function createProduct(ctx: TenantContext, i: ProductInput): Promise<ProductView> {
  await guard(ctx)
  const input = parse(createSchema, i)
  await assertCategory(ctx, input.categoryId)
  const row = await ctx.db.$transaction(async (tx) => {
    // A ordem é da conta: dois produtos criados juntos não ficam com a mesma posição.
    await tx.$lockKey('store', ctx.businessId)
    const last = await tx.product.aggregate({ _max: { displayOrder: true } })
    const created = await tx.product.create({ data: { businessId: ctx.businessId, ...input, displayOrder: (last._max.displayOrder ?? 0) + 1 }, include: withImages })
    await audit(ctx, { action: 'product.created', targetType: 'Product', targetId: created.id, metadata: { priceCents: created.priceCents, stock: created.stock } }, tx)
    return created
  }, TX_OPTIONS)
  return toView(ctx, row)
}

/**
 * Com `expectedStock` (o estoque que o formulário leu), a gravação do estoque só vale se ele ainda é esse: uma venda no meio
 * muda o estoque e gravar o valor lido a desfaria (`conflict` `changed`). Para entrada e saída use `adjustStock`.
 */
export async function updateProduct(ctx: TenantContext, id: string, i: Partial<ProductInput> & { expectedStock?: number }): Promise<ProductView> {
  await guard(ctx)
  const { expectedStock, ...changes } = definedOnly(parse(updateSchema, i))
  // Estoque só muda sabendo qual era (uma venda no meio não pode ser desfeita) ou por `adjustStock`: nada de gravar às cegas.
  if (changes.stock !== undefined && expectedStock === undefined) {
    throw fieldError('stock', 'Para mudar o estoque use "Ajustar estoque": ele não desfaz uma venda feita no meio.')
  }
  const current = await loadRow(ctx, id)
  const price = changes.priceCents ?? current.priceCents
  const promo = changes.promoPriceCents !== undefined ? changes.promoPriceCents : current.promoPriceCents
  if (promo !== null && promo >= price) throw fieldError('promoPriceCents', PROMO_MESSAGE)
  if (changes.categoryId !== undefined && changes.categoryId !== current.categoryId) await assertCategory(ctx, changes.categoryId)
  const row = await ctx.db.$transaction(async (tx) => {
    const guardStock = expectedStock !== undefined && changes.stock !== undefined
    const { count } = await tx.product.updateMany({ where: { id, ...(guardStock ? { stock: expectedStock } : {}) }, data: changes })
    if (count === 0) {
      if (guardStock) {
        const message = 'O estoque mudou agora. Recarregue para ver.'
        throw new DomainError('conflict', message, { reason: 'changed', fields: { stock: message } })
      }
      throw notFound()
    }
    await audit(ctx, { action: 'product.updated', targetType: 'Product', targetId: id, metadata: { fields: Object.keys(changes).join(',') } }, tx)
    return orNotFound(await tx.product.findUnique({ where: { id }, include: withImages }), 'Produto')
  })
  return toView(ctx, row)
}

/** Entrada (positivo) ou saída (negativo) manual de estoque, com motivo. O estoque nunca fica negativo nem passa de 100.000. */
export async function adjustStock(ctx: TenantContext, id: string, delta: number, reason: string): Promise<ProductView> {
  await guard(ctx)
  const input = parse(adjustSchema, { delta, reason })
  await loadRow(ctx, id)
  const row = await ctx.db.$transaction(async (tx) => {
    const { count } =
      input.delta < 0
        ? await tx.product.updateMany({ where: { id, stock: { gte: -input.delta } }, data: { stock: { decrement: -input.delta } } })
        : await tx.product.updateMany({ where: { id, stock: { lte: MAX_STOCK - input.delta } }, data: { stock: { increment: input.delta } } })
    if (count === 0) {
      const atual = orNotFound(await tx.product.findUnique({ where: { id }, select: { stock: true } }), 'Produto')
      throw fieldError(
        'delta',
        input.delta < 0
          ? `Há só ${atual.stock} ${atual.stock === 1 ? 'unidade' : 'unidades'} em estoque. Não dá para tirar ${-input.delta}.`
          : 'O estoque passaria de 100.000 unidades. Use uma quantidade menor.',
      )
    }
    const after = orNotFound(await tx.product.findUnique({ where: { id }, include: withImages }), 'Produto')
    await audit(
      ctx,
      { action: 'product.stock_adjusted', targetType: 'Product', targetId: id, metadata: { delta: input.delta, from: after.stock - input.delta, to: after.stock, reason: input.reason } },
      tx,
    )
    return after
  }, TX_OPTIONS)
  return toView(ctx, row)
}

/** Arquiva o produto: sai da lista e do app; os pedidos antigos continuam com o nome e o preço da compra. */
export async function archiveProduct(ctx: TenantContext, id: string): Promise<void> {
  await guard(ctx)
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.product.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: ctx.clock() } })
    if (count === 1) await audit(ctx, { action: 'product.archived', targetType: 'Product', targetId: id }, tx)
  })
}

function fileAuthor(ctx: TenantContext): { type: 'USER' | 'PLATFORM_ADMIN'; id: string | null } {
  const actor = ctx.actor
  if (actor.kind === 'member') return { type: 'USER', id: actor.userId }
  if (actor.kind === 'impersonator' || actor.kind === 'platform_admin') return { type: 'PLATFORM_ADMIN', id: actor.adminId }
  throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

const tooManyImages = (): DomainError =>
  new DomainError('validation', 'O produto já tem 6 imagens. Remova uma antes de enviar outra.', { fields: { file: 'O produto já tem 6 imagens.' }, details: { imageCode: 'too_many_images' } })

/** Acrescenta uma imagem no fim da galeria (até 6). Grava o arquivo, liga ao produto numa transação e desfaz o arquivo se a ligação falhar. */
export async function addProductImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array }): Promise<ProductView> {
  await guard(ctx)
  const before = await loadRow(ctx, id)
  if (before.images.length >= MAX_IMAGES) throw tooManyImages()
  const author = fileAuthor(ctx)
  let created: { id: string; path: string }
  try {
    created = await saveImage({ businessId: ctx.businessId, data: Buffer.from(file.bytes), purpose: 'generic', createdBy: author })
  } catch (e) {
    if (e instanceof ImageError) throw new DomainError('validation', e.message, { fields: { file: e.message }, details: { imageCode: e.code } })
    throw e
  }
  try {
    const row = await ctx.db.$transaction(async (tx) => {
      await tx.$lockKey('store', ctx.businessId)
      orNotFound(await tx.product.findUnique({ where: { id }, select: { id: true } }), 'Produto')
      const last = await tx.productImage.aggregate({ where: { productId: id }, _max: { position: true }, _count: { _all: true } })
      if (last._count._all >= MAX_IMAGES) throw tooManyImages()
      await tx.productImage.create({ data: { businessId: ctx.businessId, productId: id, uploadId: created.id, position: (last._max.position ?? 0) + 1 } })
      await audit(ctx, { action: 'product.image_added', targetType: 'Product', targetId: id }, tx)
      return orNotFound(await tx.product.findUnique({ where: { id }, include: withImages }), 'Produto')
    }, TX_OPTIONS)
    return toView(ctx, row)
  } catch (e) {
    const path = await deleteUploadRecord(ctx.db, created.id).catch(() => null)
    if (path) await removeUploadFile(path)
    throw e
  }
}

export async function removeProductImage(ctx: TenantContext, id: string, imageId: string): Promise<ProductView> {
  await guard(ctx)
  await loadRow(ctx, id)
  if (!idSchema.safeParse(imageId).success) throw new DomainError('not_found', 'Imagem não encontrada.')
  const { row, path } = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('store', ctx.businessId)
    const image = await tx.productImage.findFirst({ where: { id: imageId, productId: id } })
    if (image === null) throw new DomainError('not_found', 'Imagem não encontrada.')
    await tx.productImage.deleteMany({ where: { id: imageId } })
    // A galeria fica sem buracos: as seguintes sobem uma posição, da menor para a maior (a posição liberada acabou de vagar).
    const next = await tx.productImage.findMany({ where: { productId: id, position: { gt: image.position } }, orderBy: { position: 'asc' }, select: { id: true, position: true } })
    for (const n of next) await tx.productImage.update({ where: { id: n.id }, data: { position: n.position - 1 } })
    const filePath = await deleteUploadRecord(tx, image.uploadId)
    await audit(ctx, { action: 'product.image_removed', targetType: 'Product', targetId: id }, tx)
    return { row: orNotFound(await tx.product.findUnique({ where: { id }, include: withImages }), 'Produto'), path: filePath }
  }, TX_OPTIONS)
  if (path !== null) await removeUploadFile(path)
  return toView(ctx, row)
}

/** Sobe ou desce uma imagem na galeria, trocando de lugar com a vizinha. Nas pontas não faz nada. */
export async function moveProductImage(ctx: TenantContext, id: string, imageId: string, direction: 'up' | 'down'): Promise<ProductView> {
  await guard(ctx)
  await loadRow(ctx, id)
  if (!idSchema.safeParse(imageId).success) throw new DomainError('not_found', 'Imagem não encontrada.')
  const row = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('store', ctx.businessId)
    const all = await tx.productImage.findMany({ where: { productId: id }, orderBy: { position: 'asc' }, select: { id: true, position: true } })
    const from = all.findIndex((i) => i.id === imageId)
    if (from < 0) throw new DomainError('not_found', 'Imagem não encontrada.')
    const to = direction === 'up' ? from - 1 : from + 1
    const a = all[from]
    const b = all[to]
    if (a !== undefined && b !== undefined) {
      // Passa por uma posição livre (0) porque a posição é única por produto.
      await tx.productImage.update({ where: { id: a.id }, data: { position: 0 } })
      await tx.productImage.update({ where: { id: b.id }, data: { position: a.position } })
      await tx.productImage.update({ where: { id: a.id }, data: { position: b.position } })
      await audit(ctx, { action: 'product.image_moved', targetType: 'Product', targetId: id, metadata: { direction } }, tx)
    }
    return orNotFound(await tx.product.findUnique({ where: { id }, include: withImages }), 'Produto')
  }, TX_OPTIONS)
  return toView(ctx, row)
}
