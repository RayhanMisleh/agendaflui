import type { TenantContext } from '@/server/auth/actor'
import type { Partner, Prisma, Upload, Voucher } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { definedOnly } from '@/server/domain/input'
import { requireModule } from '@/server/domain/modules'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { swapImage } from '@/server/domain/vouchers/images'
import { publicUploadUrl, uploadUrl } from '@/server/storage/images'

export type VoucherInput = {
  partnerId: string
  name: string
  description: string | null
  terms: string | null
  priceCents: number
  stock: number
  validDays: number | null
  active: boolean
}
export type VoucherView = VoucherInput & { id: string; imageUrl: string | null; partnerName: string; displayOrder: number; archivedAt: Date | null; sold: number; redeemed: number }
export type PublicVoucher = {
  id: string
  name: string
  description: string | null
  terms: string | null
  priceCents: number
  validDays: number | null
  available: boolean
  maxQuantity: number
  imageUrl: string | null
  partner: { name: string; address: string | null; phone: string | null; website: string | null; logoUrl: string | null }
}

type Row = Voucher & { image: Upload | null; partner: Partner & { logo: Upload | null } }

export const MAX_VOUCHER_STOCK = 100_000
export const MAX_PER_ORDER_LINE = 99
const MAX_PRICE_CENTS = 100_000_000
const MAX_LIST = 500

const idSchema = z.uuid()
const withExtras = { image: true, partner: { include: { logo: true } } } as const satisfies Prisma.VoucherInclude

/** O que a vitrine e a venda enxergam: voucher ativo e não arquivado, de parceiro ativo e não arquivado. */
export const PUBLIC_VOUCHER_FILTER: Prisma.VoucherWhereInput = { active: true, archivedAt: null, partner: { active: true, archivedAt: null } }

const stockField = z
  .number('Informe o estoque.')
  .int('Informe um número inteiro de unidades.')
  .min(0, 'O estoque não pode ser negativo.')
  .max(MAX_VOUCHER_STOCK, 'O estoque máximo é de 100.000 unidades.')

const text = (max: number, limite: string) =>
  z
    .string()
    .trim()
    .max(max, limite)
    .transform((t) => (t === '' ? null : t))
    .nullable()

const fields = {
  partnerId: z.uuid('Escolha um parceiro da lista.'),
  name: z.string('Informe o nome do voucher.').trim().min(1, 'Informe o nome do voucher.').max(120, 'Use até 120 caracteres no nome.'),
  description: text(1000, 'Use até 1.000 caracteres na descrição.'),
  terms: text(2000, 'Use até 2.000 caracteres nas regras de uso.'),
  priceCents: z
    .number('Informe o preço em reais.')
    .int('Informe o preço em centavos inteiros.')
    .min(1, 'O preço precisa ser maior que zero.')
    .max(MAX_PRICE_CENTS, 'O preço é alto demais.'),
  stock: stockField,
  validDays: z
    .number('Informe a validade em dias ou deixe em branco.')
    .int('Informe a validade em dias inteiros.')
    .min(1, 'A validade mínima é de 1 dia.')
    .max(730, 'A validade máxima é de 730 dias.')
    .nullable(),
  active: z.boolean('Informe se o voucher está à venda.'),
}
const createSchema = z.object(fields)
const updateSchema = z.object({ ...fields, expectedStock: stockField }).partial()

const listSchema = z.object({ partnerId: z.uuid('Escolha um parceiro válido.').optional(), situation: z.enum(['active', 'inactive', 'archived'], 'Escolha uma situação válida.').optional() })

const notFound = (): DomainError => new DomainError('not_found', 'Voucher não encontrado.')
const fieldError = (field: string, message: string): DomainError => new DomainError('validation', message, { fields: { [field]: message } })

function imageOf(ctx: TenantContext, u: Upload | null): string | null {
  return ctx.channel === 'app' ? publicUploadUrl(u) : uploadUrl(u)
}

function toView(ctx: TenantContext, row: Row, counts: { sold: number; redeemed: number }): VoucherView {
  return {
    id: row.id,
    partnerId: row.partnerId,
    name: row.name,
    description: row.description,
    terms: row.terms,
    priceCents: row.priceCents,
    stock: row.stock,
    validDays: row.validDays,
    active: row.active,
    imageUrl: imageOf(ctx, row.image),
    partnerName: row.partner.name,
    displayOrder: row.displayOrder,
    archivedAt: row.archivedAt,
    sold: counts.sold,
    redeemed: counts.redeemed,
  }
}

function toPublic(ctx: TenantContext, row: Row): PublicVoucher {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    terms: row.terms,
    priceCents: row.priceCents,
    validDays: row.validDays,
    available: row.stock > 0,
    maxQuantity: Math.min(row.stock, MAX_PER_ORDER_LINE),
    imageUrl: imageOf(ctx, row.image),
    partner: { name: row.partner.name, address: row.partner.address, phone: row.partner.phone, website: row.partner.website, logoUrl: imageOf(ctx, row.partner.logo) },
  }
}

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'vouchers')
  authorize(ctx, 'manage_vouchers')
}

async function loadRow(ctx: TenantContext, id: string): Promise<Row> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await ctx.db.voucher.findUnique({ where: { id }, include: withExtras }), 'Voucher')
}

/** Quantas unidades foram vendidas (códigos vivos ou usados; os anulados não contam) e quantas já foram usadas, por voucher. */
async function countsOf(ctx: TenantContext, ids: string[]): Promise<Map<string, { sold: number; redeemed: number }>> {
  const map = new Map<string, { sold: number; redeemed: number }>()
  if (ids.length === 0) return map
  const groups = await ctx.db.voucherCode.groupBy({ by: ['voucherId', 'status'], where: { voucherId: { in: ids }, status: { in: ['ACTIVE', 'REDEEMED'] } }, _count: { _all: true } })
  for (const g of groups) {
    const cur = map.get(g.voucherId) ?? { sold: 0, redeemed: 0 }
    cur.sold += g._count._all
    if (g.status === 'REDEEMED') cur.redeemed += g._count._all
    map.set(g.voucherId, cur)
  }
  return map
}

async function viewOf(ctx: TenantContext, row: Row): Promise<VoucherView> {
  return toView(ctx, row, (await countsOf(ctx, [row.id])).get(row.id) ?? { sold: 0, redeemed: 0 })
}

/** O parceiro precisa ser da conta, ativo e não arquivado. */
async function assertPartner(ctx: TenantContext, partnerId: string): Promise<void> {
  const found = await ctx.db.partner.findFirst({ where: { id: partnerId, active: true, archivedAt: null }, select: { id: true } })
  if (found === null) throw fieldError('partnerId', 'Escolha um parceiro ativo da lista.')
}

/** Lista da equipe: por padrão os não arquivados; filtra por parceiro e situação. */
export async function listVouchers(ctx: TenantContext, q: { partnerId?: string; situation?: 'active' | 'inactive' | 'archived' } = {}): Promise<VoucherView[]> {
  await guard(ctx)
  const f = parse(listSchema, q)
  const base: Prisma.VoucherWhereInput =
    f.situation === 'archived' ? { archivedAt: { not: null } } : f.situation === 'active' ? { archivedAt: null, active: true } : f.situation === 'inactive' ? { archivedAt: null, active: false } : { archivedAt: null }
  const rows = await ctx.db.voucher.findMany({ where: { AND: [base, f.partnerId !== undefined ? { partnerId: f.partnerId } : {}] }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], include: withExtras, take: MAX_LIST })
  const counts = await countsOf(ctx, rows.map((r) => r.id))
  return rows.map((r) => toView(ctx, r, counts.get(r.id) ?? { sold: 0, redeemed: 0 }))
}

export async function getVoucher(ctx: TenantContext, id: string): Promise<VoucherView> {
  await guard(ctx)
  return viewOf(ctx, await loadRow(ctx, id))
}

/** Vitrine do app: só o que está à venda, sem estoque nem dado interno. */
export async function listPublicVouchers(ctx: TenantContext): Promise<PublicVoucher[]> {
  await requireModule(ctx, 'vouchers')
  const rows = await ctx.db.voucher.findMany({ where: PUBLIC_VOUCHER_FILTER, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }], include: withExtras, take: MAX_LIST })
  return rows.map((r) => toPublic(ctx, r))
}

export async function getPublicVoucher(ctx: TenantContext, id: string): Promise<PublicVoucher> {
  await requireModule(ctx, 'vouchers')
  if (!idSchema.safeParse(id).success) throw notFound()
  const row = await ctx.db.voucher.findFirst({ where: { AND: [{ id }, PUBLIC_VOUCHER_FILTER] }, include: withExtras })
  if (row === null) throw notFound()
  return toPublic(ctx, row)
}

export async function createVoucher(ctx: TenantContext, i: VoucherInput): Promise<VoucherView> {
  await guard(ctx)
  const input = parse(createSchema, i)
  await assertPartner(ctx, input.partnerId)
  const row = await ctx.db.$transaction(async (tx) => {
    // A ordem é da conta: dois vouchers criados juntos não ficam com a mesma posição.
    await tx.$lockKey('store', ctx.businessId)
    const last = await tx.voucher.aggregate({ _max: { displayOrder: true } })
    const created = await tx.voucher.create({ data: { businessId: ctx.businessId, ...input, displayOrder: (last._max.displayOrder ?? 0) + 1 }, include: withExtras })
    await audit(ctx, { action: 'voucher.created', targetType: 'Voucher', targetId: created.id, metadata: { priceCents: created.priceCents, stock: created.stock } }, tx)
    return created
  }, TX_OPTIONS)
  return toView(ctx, row, { sold: 0, redeemed: 0 })
}

/**
 * Mudar o estoque pede o `expectedStock` (o que o formulário leu): uma venda no meio muda o estoque e gravar o valor lido a
 * desfaria (`conflict` `changed`).
 */
export async function updateVoucher(ctx: TenantContext, id: string, i: Partial<VoucherInput> & { expectedStock?: number }): Promise<VoucherView> {
  await guard(ctx)
  const { expectedStock, ...changes } = definedOnly(parse(updateSchema, i))
  if (changes.stock !== undefined && expectedStock === undefined) {
    throw fieldError('stock', 'Para mudar o estoque, a tela precisa informar o estoque que você viu. Recarregue a página e tente de novo.')
  }
  const current = await loadRow(ctx, id)
  if (changes.partnerId !== undefined && changes.partnerId !== current.partnerId) await assertPartner(ctx, changes.partnerId)
  const row = await ctx.db.$transaction(async (tx) => {
    const guardStock = expectedStock !== undefined && changes.stock !== undefined
    const { count } = await tx.voucher.updateMany({ where: { id, ...(guardStock ? { stock: expectedStock } : {}) }, data: changes })
    if (count === 0) {
      if (guardStock) {
        const message = 'O estoque mudou agora (houve uma venda). Recarregue para ver.'
        throw new DomainError('conflict', message, { reason: 'changed', fields: { stock: message } })
      }
      throw notFound()
    }
    await audit(ctx, { action: 'voucher.updated', targetType: 'Voucher', targetId: id, metadata: { fields: Object.keys(changes).join(',') } }, tx)
    return orNotFound(await tx.voucher.findUnique({ where: { id }, include: withExtras }), 'Voucher')
  }, TX_OPTIONS)
  return viewOf(ctx, row)
}

/** Arquiva o voucher: sai da lista e da vitrine; os pedidos e os códigos já vendidos seguem valendo. */
export async function archiveVoucher(ctx: TenantContext, id: string): Promise<void> {
  await guard(ctx)
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.voucher.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: ctx.clock() } })
    if (count === 1) await audit(ctx, { action: 'voucher.archived', targetType: 'Voucher', targetId: id }, tx)
  })
}

/** Troca (ou, com `file: null`, remove) a imagem do voucher. */
export async function setVoucherImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<VoucherView> {
  await guard(ctx)
  await loadRow(ctx, id)
  await swapImage(ctx, {
    file,
    purpose: 'generic',
    attach: async (tx, uploadId) => {
      const atual = orNotFound(await tx.voucher.findUnique({ where: { id }, select: { imageUploadId: true } }), 'Voucher')
      await tx.voucher.update({ where: { id }, data: { imageUploadId: uploadId } })
      await audit(ctx, { action: 'voucher.image_changed', targetType: 'Voucher', targetId: id, metadata: { change: uploadId === null ? 'removed' : atual.imageUploadId === null ? 'added' : 'replaced' } }, tx)
      return { row: null, previous: atual.imageUploadId }
    },
  })
  return viewOf(ctx, await loadRow(ctx, id))
}
