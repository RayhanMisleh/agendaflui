import type { TenantContext } from '@/server/auth/actor'
import type { Prisma, Prize, Upload } from '@/server/db/generated/client'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { definedOnly, isCustomer } from '@/server/domain/input'
import { requireModule } from '@/server/domain/modules'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { deleteUploadRecord, ImageError, publicUploadUrl, removeUploadFile, saveImage, uploadUrl } from '@/server/storage/images'

export type PrizeInput = { name: string; description: string | null; costPoints: number; stock: number | null; active: boolean }

export type PrizeView = PrizeInput & {
  id: string
  imageUrl: string | null
  displayOrder: number
  archivedAt: Date | null
}

type PrizeRow = Prize & { image: Upload | null }

const MAX_POINTS = 1_000_000
const idSchema = z.uuid()
const withImage = { image: true } as const

const fields = {
  name: z.string('Informe o nome do prêmio.').trim().min(1, 'Informe o nome do prêmio.').max(80, 'Use até 80 caracteres no nome.'),
  description: z
    .string()
    .trim()
    .max(500, 'Use até 500 caracteres na descrição.')
    .transform((t) => (t === '' ? null : t))
    .nullable(),
  costPoints: z
    .number('Informe o custo em pontos.')
    .int('Informe um número inteiro de pontos.')
    .min(1, 'O custo precisa ser de pelo menos 1 ponto.')
    .max(MAX_POINTS, 'O custo máximo é de 1.000.000 de pontos.'),
  stock: z
    .number('Informe o estoque ou deixe sem limite.')
    .int('Informe um número inteiro de unidades.')
    .min(0, 'O estoque não pode ser negativo.')
    .max(MAX_POINTS, 'O estoque máximo é de 1.000.000 de unidades.')
    .nullable(),
  active: z.boolean('Informe se o prêmio está ativo.'),
}

const createSchema = z.object(fields)
const updateSchema = z.object({ ...fields, expectedStock: z.number().int().min(0).nullable() }).partial()

function toView(ctx: TenantContext, row: PrizeRow): PrizeView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    costPoints: row.costPoints,
    stock: row.stock,
    active: row.active,
    imageUrl: ctx.channel === 'app' ? publicUploadUrl(row.image) : uploadUrl(row.image),
    displayOrder: row.displayOrder,
    archivedAt: row.archivedAt,
  }
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Prêmio não encontrado.')
}

async function loadRow(ctx: TenantContext, id: string): Promise<PrizeRow> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await ctx.db.prize.findUnique({ where: { id }, include: withImage }), 'Prêmio')
}

/** Vitrine do cliente e do visitante: ativo, não arquivado e com estoque diferente de zero. */
const VISIBLE: Prisma.PrizeWhereInput = { active: true, archivedAt: null, OR: [{ stock: null }, { stock: { gt: 0 } }] }

/**
 * Cliente e visitante veem só a vitrine (as opções são ignoradas). A equipe com `manage_loyalty` vê os ativos e não
 * arquivados, e pede os inativos e os arquivados pelas opções.
 */
export async function listPrizes(
  ctx: TenantContext,
  q: { includeInactive?: boolean; includeArchived?: boolean } = {},
): Promise<PrizeView[]> {
  await requireModule(ctx, 'loyalty')
  let where: Prisma.PrizeWhereInput
  if (isCustomer(ctx)) {
    where = VISIBLE
  } else {
    authorize(ctx, 'manage_loyalty')
    where = { ...(q.includeInactive ? {} : { active: true }), ...(q.includeArchived ? {} : { archivedAt: null }) }
  }
  const rows = await ctx.db.prize.findMany({ where, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], include: withImage })
  return rows.map((r) => toView(ctx, r))
}

export async function getPrize(ctx: TenantContext, id: string): Promise<PrizeView> {
  await requireModule(ctx, 'loyalty')
  if (!isCustomer(ctx)) authorize(ctx, 'manage_loyalty')
  const row = await loadRow(ctx, id)
  if (isCustomer(ctx) && (!row.active || row.archivedAt !== null)) throw notFound()
  return toView(ctx, row)
}

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'loyalty')
  authorize(ctx, 'manage_loyalty')
}

export async function createPrize(ctx: TenantContext, i: PrizeInput): Promise<PrizeView> {
  await guard(ctx)
  const input = parse(createSchema, i)
  const row = await ctx.db.$transaction(async (tx) => {
    // A ordem é da conta: dois prêmios criados juntos não ficam com a mesma posição.
    await tx.$lockKey('loyalty', ctx.businessId)
    const last = await tx.prize.aggregate({ _max: { displayOrder: true } })
    const created = await tx.prize.create({
      data: { businessId: ctx.businessId, ...input, displayOrder: (last._max.displayOrder ?? 0) + 1 },
      include: withImage,
    })
    await audit(ctx, { action: 'prize.created', targetType: 'Prize', targetId: created.id, metadata: { costPoints: created.costPoints } }, tx)
    return created
  }, TX_OPTIONS)
  return toView(ctx, row)
}

/**
 * Com `expectedStock` (o estoque que o formulário leu), a gravação só vale se o estoque ainda é esse: um resgate no meio
 * muda o estoque, e gravar o valor lido o desfaria. Mudou → `conflict` e nada é gravado.
 */
export async function updatePrize(ctx: TenantContext, id: string, i: Partial<PrizeInput> & { expectedStock?: number | null }): Promise<PrizeView> {
  await guard(ctx)
  const { expectedStock, ...changes } = definedOnly(parse(updateSchema, i))
  await loadRow(ctx, id)
  const row = await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.prize.updateMany({ where: { id, ...(expectedStock !== undefined ? { stock: expectedStock } : {}) }, data: changes })
    if (count === 0) {
      if (expectedStock !== undefined) throw new DomainError('conflict', 'O estoque mudou agora. Recarregue para ver.', { reason: 'changed', fields: { stock: 'O estoque mudou agora. Recarregue para ver.' } })
      throw notFound()
    }
    const updated = orNotFound(await tx.prize.findUnique({ where: { id }, include: withImage }), 'Prêmio')
    await audit(ctx, { action: 'prize.updated', targetType: 'Prize', targetId: id, metadata: { fields: Object.keys(changes).join(',') } }, tx)
    return updated
  })
  return toView(ctx, row)
}

export async function archivePrize(ctx: TenantContext, id: string): Promise<void> {
  await guard(ctx)
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.prize.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: ctx.clock() } })
    if (count === 1) await audit(ctx, { action: 'prize.archived', targetType: 'Prize', targetId: id }, tx)
  })
}

/** Sobe ou desce um prêmio na ordem da vitrine, trocando de lugar com o vizinho (não arquivado). Nas pontas não faz nada. */
export async function movePrize(ctx: TenantContext, id: string, direction: 'up' | 'down'): Promise<void> {
  await guard(ctx)
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('loyalty', ctx.businessId)
    const all = await tx.prize.findMany({ where: { archivedAt: null }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], select: { id: true, displayOrder: true } })
    const from = all.findIndex((p) => p.id === id)
    const to = direction === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= all.length) return
    const order = all.map((p) => p.id)
    const [moved] = order.splice(from, 1)
    if (moved === undefined) return
    order.splice(to, 0, moved)
    // Renumera a lista inteira: a ordem fica sem repetição mesmo se linhas antigas tiverem a mesma posição.
    for (const [index, prizeId] of order.entries()) {
      if (all.find((p) => p.id === prizeId)?.displayOrder !== index + 1) {
        await tx.prize.update({ where: { id: prizeId }, data: { displayOrder: index + 1 } })
      }
    }
    await audit(ctx, { action: 'prize.moved', targetType: 'Prize', targetId: id, metadata: { direction } }, tx)
  }, TX_OPTIONS)
}

function fileAuthor(ctx: TenantContext): { type: 'USER' | 'PLATFORM_ADMIN'; id: string | null } {
  const actor = ctx.actor
  if (actor.kind === 'member') return { type: 'USER', id: actor.userId }
  if (actor.kind === 'impersonator' || actor.kind === 'platform_admin') return { type: 'PLATFORM_ADMIN', id: actor.adminId }
  throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

/**
 * Troca (ou, com `file: null`, remove) a imagem do prêmio. O tipo vem dos bytes. Grava a nova, liga ao prêmio numa transação
 * e só depois apaga a antiga; se a ligação falhar, a nova é desfeita.
 */
export async function setPrizeImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<PrizeView> {
  await guard(ctx)
  await loadRow(ctx, id)
  const author = fileAuthor(ctx)
  let created: { id: string; path: string } | null = null
  if (file !== null) {
    try {
      created = await saveImage({ businessId: ctx.businessId, data: Buffer.from(file.bytes), purpose: 'generic', createdBy: author })
    } catch (e) {
      if (e instanceof ImageError) throw new DomainError('validation', e.message, { fields: { file: e.message }, details: { imageCode: e.code } })
      throw e
    }
  }
  let previous: string | null = null
  let row: PrizeRow
  try {
    ;({ row, previous } = await ctx.db.$transaction(async (tx: TenantTx) => {
      await tx.$lockKey('loyalty', ctx.businessId)
      const atual = orNotFound(await tx.prize.findUnique({ where: { id }, select: { imageUploadId: true } }), 'Prêmio')
      const updated = await tx.prize.update({ where: { id }, data: { imageUploadId: created?.id ?? null }, include: withImage })
      await audit(
        ctx,
        { action: 'prize.image_changed', targetType: 'Prize', targetId: id, metadata: { change: created === null ? 'removed' : atual.imageUploadId === null ? 'added' : 'replaced' } },
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
