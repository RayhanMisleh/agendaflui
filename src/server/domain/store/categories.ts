import type { TenantContext } from '@/server/auth/actor'
import type { ProductCategory } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { searchKey } from '@/server/domain/customers/contact'
import { authorize, DomainError, isUniqueViolation, orNotFound, parse, z } from '@/server/domain/errors'
import { isCustomer } from '@/server/domain/input'
import { requireModule } from '@/server/domain/modules'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'

export type CategoryView = { id: string; name: string; displayOrder: number; productCount: number; archivedAt: Date | null }

const idSchema = z.uuid()

const nameSchema = z.object({
  name: z.string('Informe o nome da categoria.').trim().min(1, 'Informe o nome da categoria.').max(60, 'Use até 60 caracteres no nome.'),
})

const NAME_TAKEN = 'Já existe uma categoria com este nome. Use outro nome.'
const nameTaken = (): DomainError => new DomainError('conflict', NAME_TAKEN, { fields: { name: NAME_TAKEN } })
const notFound = (): DomainError => new DomainError('not_found', 'Categoria não encontrada.')

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'store')
  authorize(ctx, 'manage_store')
}

async function loadRow(ctx: TenantContext, id: string): Promise<ProductCategory> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await ctx.db.productCategory.findUnique({ where: { id } }), 'Categoria')
}

function toView(row: ProductCategory, productCount: number): CategoryView {
  return { id: row.id, name: row.name, displayOrder: row.displayOrder, productCount, archivedAt: row.archivedAt }
}

/**
 * Categorias em ordem. A equipe (`manage_store`) conta os produtos não arquivados da categoria e pode pedir as arquivadas;
 * o app (cliente e visitante) vê só as não arquivadas e conta só os produtos à venda.
 */
export async function listCategories(ctx: TenantContext, q: { includeArchived?: boolean } = {}): Promise<CategoryView[]> {
  await requireModule(ctx, 'store')
  const forApp = isCustomer(ctx)
  if (!forApp) authorize(ctx, 'manage_store')
  const rows = await ctx.db.productCategory.findMany({
    where: !forApp && q.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  })
  const counts = await ctx.db.product.groupBy({
    by: ['categoryId'],
    where: { archivedAt: null, categoryId: { not: null }, ...(forApp ? { active: true } : {}) },
    _count: { _all: true },
  })
  const byId = new Map(counts.map((c) => [c.categoryId, c._count._all]))
  return rows.map((r) => toView(r, byId.get(r.id) ?? 0))
}

export async function createCategory(ctx: TenantContext, i: { name: string }): Promise<CategoryView> {
  await guard(ctx)
  const { name } = parse(nameSchema, i)
  const nameKey = searchKey(name)
  try {
    const row = await ctx.db.$transaction(async (tx) => {
      // A ordem é da conta: duas categorias criadas juntas não ficam com a mesma posição.
      await tx.$lockKey('store', ctx.businessId)
      const last = await tx.productCategory.aggregate({ _max: { displayOrder: true } })
      const created = await tx.productCategory.create({ data: { businessId: ctx.businessId, name, nameKey, displayOrder: (last._max.displayOrder ?? 0) + 1 } })
      await audit(ctx, { action: 'product_category.created', targetType: 'ProductCategory', targetId: created.id }, tx)
      return created
    }, TX_OPTIONS)
    return toView(row, 0)
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken()
    throw err
  }
}

export async function renameCategory(ctx: TenantContext, id: string, i: { name: string }): Promise<CategoryView> {
  await guard(ctx)
  const { name } = parse(nameSchema, i)
  await loadRow(ctx, id)
  try {
    const row = await ctx.db.$transaction(async (tx) => {
      const { count } = await tx.productCategory.updateMany({ where: { id }, data: { name, nameKey: searchKey(name) } })
      if (count === 0) throw notFound()
      await audit(ctx, { action: 'product_category.renamed', targetType: 'ProductCategory', targetId: id }, tx)
      return tx.productCategory.findUniqueOrThrow({ where: { id } })
    })
    const count = await ctx.db.product.count({ where: { categoryId: id, archivedAt: null } })
    return toView(row, count)
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken()
    throw err
  }
}

/** Arquiva a categoria: sai da lista e do app (os produtos dela deixam de aparecer ao app), os dados ficam. */
export async function archiveCategory(ctx: TenantContext, id: string): Promise<void> {
  await guard(ctx)
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.productCategory.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: ctx.clock() } })
    if (count === 1) await audit(ctx, { action: 'product_category.archived', targetType: 'ProductCategory', targetId: id }, tx)
  })
}

/** Sobe ou desce uma categoria na ordem, trocando de lugar com a vizinha (não arquivada). Nas pontas não faz nada. */
export async function moveCategory(ctx: TenantContext, id: string, direction: 'up' | 'down'): Promise<void> {
  await guard(ctx)
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('store', ctx.businessId)
    const all = await tx.productCategory.findMany({ where: { archivedAt: null }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], select: { id: true, displayOrder: true } })
    const from = all.findIndex((c) => c.id === id)
    const to = direction === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= all.length) return
    const order = all.map((c) => c.id)
    const [moved] = order.splice(from, 1)
    if (moved === undefined) return
    order.splice(to, 0, moved)
    // Renumera a lista inteira: a ordem fica sem repetição mesmo se linhas antigas tiverem a mesma posição.
    for (const [index, categoryId] of order.entries()) {
      if (all.find((c) => c.id === categoryId)?.displayOrder !== index + 1) {
        await tx.productCategory.update({ where: { id: categoryId }, data: { displayOrder: index + 1 } })
      }
    }
    await audit(ctx, { action: 'product_category.moved', targetType: 'ProductCategory', targetId: id, metadata: { direction } }, tx)
  }, TX_OPTIONS)
}
