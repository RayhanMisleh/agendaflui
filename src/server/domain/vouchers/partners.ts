import type { TenantContext } from '@/server/auth/actor'
import type { Partner, Upload } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { definedOnly } from '@/server/domain/input'
import { requireModule } from '@/server/domain/modules'
import { swapImage } from '@/server/domain/vouchers/images'
import { publicUploadUrl, uploadUrl } from '@/server/storage/images'

export type PartnerInput = { name: string; description: string | null; address: string | null; phone: string | null; website: string | null; active: boolean }
export type PartnerView = PartnerInput & { id: string; logoUrl: string | null; voucherCount: number; archivedAt: Date | null }

type Row = Partner & { logo: Upload | null; _count: { vouchers: number } }

const idSchema = z.uuid()
const withExtras = { logo: true, _count: { select: { vouchers: { where: { archivedAt: null } } } } } as const

const text = (max: number, limite: string) =>
  z
    .string()
    .trim()
    .max(max, limite)
    .transform((t) => (t === '' ? null : t))
    .nullable()

const WEBSITE = 'Use um endereço que comece com https://, como https://exemplo.com.br'
function websiteOk(v: string): boolean {
  if (!/^https?:\/\/[^\s]+$/i.test(v)) return false
  try {
    return new URL(v).hostname !== ''
  } catch {
    return false
  }
}

const fields = {
  name: z.string('Informe o nome do parceiro.').trim().min(1, 'Informe o nome do parceiro.').max(120, 'Use até 120 caracteres no nome.'),
  description: text(1000, 'Use até 1.000 caracteres na descrição.'),
  address: text(300, 'Use até 300 caracteres no endereço.'),
  phone: text(40, 'Use até 40 caracteres no telefone.'),
  website: z
    .string(WEBSITE)
    .trim()
    .max(300, 'Use até 300 caracteres no site.')
    .nullable()
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, c) => {
      if (v !== null && !websiteOk(v)) c.addIssue({ code: 'custom', message: WEBSITE })
    }),
  active: z.boolean('Informe se o parceiro está ativo.'),
}
const createSchema = z.object(fields)
const updateSchema = z.object(fields).partial()

const notFound = (): DomainError => new DomainError('not_found', 'Parceiro não encontrado.')

function toView(ctx: TenantContext, row: Row): PartnerView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    address: row.address,
    phone: row.phone,
    website: row.website,
    active: row.active,
    logoUrl: ctx.channel === 'app' ? publicUploadUrl(row.logo) : uploadUrl(row.logo),
    voucherCount: row._count.vouchers,
    archivedAt: row.archivedAt,
  }
}

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'vouchers')
  authorize(ctx, 'manage_vouchers')
}

async function loadRow(ctx: TenantContext, id: string): Promise<Row> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await ctx.db.partner.findUnique({ where: { id }, include: withExtras }), 'Parceiro')
}

export async function listPartners(ctx: TenantContext, q: { includeArchived?: boolean } = {}): Promise<PartnerView[]> {
  await guard(ctx)
  const rows = await ctx.db.partner.findMany({ where: q.includeArchived === true ? {} : { archivedAt: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }], include: withExtras })
  return rows.map((r) => toView(ctx, r))
}

export async function getPartner(ctx: TenantContext, id: string): Promise<PartnerView> {
  await guard(ctx)
  return toView(ctx, await loadRow(ctx, id))
}

export async function createPartner(ctx: TenantContext, i: PartnerInput): Promise<PartnerView> {
  await guard(ctx)
  const input = parse(createSchema, i)
  const row = await ctx.db.$transaction(async (tx) => {
    const created = await tx.partner.create({ data: { businessId: ctx.businessId, ...input }, include: withExtras })
    await audit(ctx, { action: 'partner.created', targetType: 'Partner', targetId: created.id }, tx)
    return created
  })
  return toView(ctx, row)
}

export async function updatePartner(ctx: TenantContext, id: string, i: Partial<PartnerInput>): Promise<PartnerView> {
  await guard(ctx)
  const changes = definedOnly(parse(updateSchema, i))
  await loadRow(ctx, id)
  const row = await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.partner.updateMany({ where: { id }, data: changes })
    if (count === 0) throw notFound()
    await audit(ctx, { action: 'partner.updated', targetType: 'Partner', targetId: id, metadata: { fields: Object.keys(changes).join(',') } }, tx)
    return orNotFound(await tx.partner.findUnique({ where: { id }, include: withExtras }), 'Parceiro')
  })
  return toView(ctx, row)
}

/** Arquiva o parceiro: sai da lista e da vitrine. Os códigos já vendidos continuam valendo no balcão. */
export async function archivePartner(ctx: TenantContext, id: string): Promise<void> {
  await guard(ctx)
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  await ctx.db.$transaction(async (tx) => {
    const { count } = await tx.partner.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: ctx.clock() } })
    if (count === 1) await audit(ctx, { action: 'partner.archived', targetType: 'Partner', targetId: id }, tx)
  })
}

/** Troca (ou, com `file: null`, remove) o logo do parceiro. */
export async function setPartnerLogo(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<PartnerView> {
  await guard(ctx)
  await loadRow(ctx, id)
  await swapImage(ctx, {
    file,
    purpose: 'logo',
    attach: async (tx, uploadId) => {
      const atual = orNotFound(await tx.partner.findUnique({ where: { id }, select: { logoUploadId: true } }), 'Parceiro')
      await tx.partner.update({ where: { id }, data: { logoUploadId: uploadId } })
      await audit(ctx, { action: 'partner.logo_changed', targetType: 'Partner', targetId: id, metadata: { change: uploadId === null ? 'removed' : atual.logoUploadId === null ? 'added' : 'replaced' } }, tx)
      return { row: null, previous: atual.logoUploadId }
    },
  })
  return toView(ctx, await loadRow(ctx, id))
}
