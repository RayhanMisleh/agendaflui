import type { TenantContext } from '@/server/auth/actor'
import type { PriceVariant, PricingMode, Prisma, Service, ServicePrice } from '@/server/db/generated/client'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { definedOnly, isCustomer } from '@/server/domain/input'
import { authorize, DomainError, isRecordNotFound, orNotFound, parse, z } from '@/server/domain/errors'
import type { VariantPriceRow } from '@/server/domain/catalog/pricing'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { isVariantVisible, NICHES, type PetOptions } from '@/server/niches'

export type ServiceView = {
  id: string
  name: string
  description: string | null
  icon: string
  priceCents: number
  durationMin: number
  rewardPoints: number
  clubOnly: boolean
  active: boolean
  displayOrder: number
  archived: boolean
  pricingMode: PricingMode
  /** Linhas por variante, na ordem do registro; o cliente só recebe as visíveis a ele. */
  prices: VariantPriceRow[]
}

export type ServiceInput = {
  name: string
  description?: string | null
  icon?: string
  /** Opcional com `BY_VARIANT` (ignorado: as colunas guardam o menor preço das linhas). */
  priceCents?: number
  /** Opcional com `BY_VARIANT` (ignorado: as colunas guardam a menor duração das linhas). */
  durationMin?: number
  pricingMode?: PricingMode
  variantPrices?: VariantPriceRow[]
  rewardPoints?: number
  clubOnly?: boolean
  active?: boolean
}

const serviceFields = {
  name: z.string().trim().min(1, 'Informe o nome do serviço.').max(80, 'Use até 80 caracteres.'),
  description: z
    .string()
    .trim()
    .max(500, 'Use até 500 caracteres.')
    .transform((texto) => (texto === '' ? null : texto))
    .nullable(),
  icon: z.string().trim().min(1, 'Escolha um ícone.').max(40, 'Use até 40 caracteres.'),
  priceCents: z
    .number()
    .int('Informe o preço em centavos, sem fração.')
    .min(0, 'O preço não pode ser negativo.')
    .max(10_000_000, 'O preço é alto demais.'),
  durationMin: z
    .number()
    .int('Informe a duração em minutos inteiros.')
    .min(5, 'A duração mínima é de 5 minutos.')
    .max(600, 'A duração máxima é de 600 minutos.')
    .multipleOf(5, 'A duração deve ser múltipla de 5 minutos.'),
  rewardPoints: z
    .number()
    .int('Informe os pontos como número inteiro.')
    .min(0, 'Os pontos não podem ser negativos.')
    .max(100_000, 'Os pontos são altos demais.'),
  clubOnly: z.boolean(),
  active: z.boolean(),
}

const variantRowSchema = z.object({
  variant: z.enum(['DOG_SMALL', 'DOG_MEDIUM', 'DOG_LARGE', 'DOG_GIANT', 'CAT'], { error: 'Escolha o porte.' }),
  priceCents: serviceFields.priceCents,
  durationMin: serviceFields.durationMin,
})

const createSchema = z.object({
  name: serviceFields.name,
  description: serviceFields.description.optional(),
  icon: serviceFields.icon.optional(),
  priceCents: serviceFields.priceCents.optional(),
  durationMin: serviceFields.durationMin.optional(),
  pricingMode: z.enum(['SINGLE', 'BY_VARIANT']).optional(),
  variantPrices: z.array(variantRowSchema).max(10, 'Há linhas demais.').optional(),
  rewardPoints: serviceFields.rewardPoints.optional(),
  clubOnly: serviceFields.clubOnly.optional(),
  active: serviceFields.active.optional(),
})

const updateSchema = createSchema.partial()

const listOptionsSchema = z.object({
  includeInactive: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
})

const idSchema = z.uuid()
const reorderSchema = z.object({ orderedIds: z.array(z.string()) })

type ServiceRow = Service & { prices: ServicePrice[] }
const withPrices = { prices: true } as const

function variantOrder(v: PriceVariant): number {
  return NICHES.PET.variants.findIndex((d) => d.key === v)
}

/** A visão do serviço. Com `options`, só as linhas visíveis entram e as colunas resumem só elas (visão do cliente). */
export function toServiceView(service: Service, prices: readonly ServicePrice[] = [], options: PetOptions | null = null): ServiceView {
  const todas = [...prices].sort((a, b) => variantOrder(a.variant) - variantOrder(b.variant))
  const linhas = options === null ? todas : todas.filter((p) => isVariantVisible(p.variant, options))
  const resumo =
    options !== null && service.pricingMode === 'BY_VARIANT' && linhas.length > 0
      ? {
          priceCents: Math.min(...linhas.map((l) => l.priceCents)),
          durationMin: Math.min(...linhas.map((l) => l.durationMin)),
        }
      : { priceCents: service.priceCents, durationMin: service.durationMin }
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    icon: service.icon,
    priceCents: resumo.priceCents,
    durationMin: resumo.durationMin,
    rewardPoints: service.rewardPoints,
    clubOnly: service.clubOnly,
    active: service.active,
    displayOrder: service.displayOrder,
    archived: service.archivedAt !== null,
    pricingMode: service.pricingMode,
    prices: linhas.map((l) => ({ variant: l.variant, priceCents: l.priceCents, durationMin: l.durationMin })),
  }
}

/** Visão para quem pediu: o cliente com linhas escondidas filtradas; a equipe, completa. */
async function viewsFor(ctx: TenantContext, rows: ServiceRow[]): Promise<ServiceView[]> {
  const options = isCustomer(ctx) && rows.some((r) => r.prices.length > 0) ? (await getNicheSettings(ctx)).options : null
  return rows.map((r) => toServiceView(r, r.prices, options))
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Serviço não encontrado.')
}

async function loadService(ctx: TenantContext, id: string): Promise<ServiceRow> {
  if (!idSchema.safeParse(id).success) throw notFound()
  const service = orNotFound(await ctx.db.service.findUnique({ where: { id }, include: withPrices }), 'Serviço')
  if (isCustomer(ctx) && (!service.active || service.archivedAt !== null)) throw notFound()
  return service
}

function archivedConflict(): DomainError {
  return new DomainError('conflict', 'Este serviço está arquivado. Restaure o serviço antes de alterá-lo.')
}

/** Opções de gravação. `onGrid`: a duração precisa ser múltipla da grade de horários da conta (o painel liga; a API não usa). */
export type ServiceWriteOptions = { onGrid?: boolean }

async function assertOnGrid(ctx: TenantContext, durationMin: number | undefined): Promise<void> {
  if (durationMin === undefined) return
  const { slotStepMin } = await getSchedulingRules(ctx)
  if (durationMin % slotStepMin !== 0) {
    const mensagem = `Use uma duração múltipla de ${slotStepMin} minutos, a grade de horários da conta.`
    throw new DomainError('validation', mensagem, { fields: { durationMin: mensagem } })
  }
}

export async function listServices(
  ctx: TenantContext,
  opts: { includeInactive?: boolean; includeArchived?: boolean } = {},
): Promise<ServiceView[]> {
  const { includeInactive, includeArchived } = parse(listOptionsSchema, opts)
  const customer = isCustomer(ctx)
  const services = await ctx.db.service.findMany({
    where: {
      ...(customer || !includeInactive ? { active: true } : {}),
      ...(customer || !includeArchived ? { archivedAt: null } : {}),
    },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    include: withPrices,
  })
  return viewsFor(ctx, services)
}

export async function getService(ctx: TenantContext, id: string): Promise<ServiceView> {
  const [view] = await viewsFor(ctx, [await loadService(ctx, id)])
  if (view === undefined) throw notFound()
  return view
}

function validation(fields: Record<string, string>): DomainError {
  return new DomainError('validation', Object.values(fields)[0] ?? 'Confira os campos informados.', { fields })
}

/** Linhas enviadas: sem repetir variante e só as visíveis (a escondida é preservada pelo servidor). */
async function checkVariantRows(
  ctx: TenantContext,
  rows: VariantPriceRow[],
  options: PetOptions,
  onGrid: boolean | undefined,
): Promise<VariantPriceRow[]> {
  const vistas = new Set<PriceVariant>()
  for (const r of rows) {
    if (vistas.has(r.variant)) throw validation({ variantPrices: 'Há um porte repetido. Use cada porte uma vez.' })
    vistas.add(r.variant)
  }
  const visiveis = rows.filter((r) => isVariantVisible(r.variant, options))
  if (visiveis.length === 0) throw validation({ variantPrices: 'Preencha o preço de pelo menos um porte.' })
  if (onGrid) {
    const { slotStepMin } = await getSchedulingRules(ctx)
    if (visiveis.some((r) => r.durationMin % slotStepMin !== 0)) {
      throw validation({ variantPrices: `Use durações múltiplas de ${slotStepMin} minutos, a grade de horários da conta.` })
    }
  }
  return visiveis
}

async function assertPriceByVariantAllowed(ctx: TenantContext, tx: TenantTx): Promise<PetOptions> {
  const { niche, options } = await getNicheSettings(ctx, tx)
  if (niche === null) throw validation({ pricingMode: 'Preço por porte só existe em conta pet shop.' })
  return options
}

/** Grava as linhas visíveis (substitui) e devolve o menor preço e a menor duração entre TODAS as linhas da conta. */
async function writeVariantRows(
  ctx: TenantContext,
  tx: TenantTx,
  serviceId: string,
  rows: VariantPriceRow[],
  options: PetOptions,
): Promise<{ priceCents: number; durationMin: number }> {
  const atuais = await tx.servicePrice.findMany({ where: { serviceId } })
  const novas = new Set(rows.map((r) => r.variant))
  for (const a of atuais) {
    // A linha escondida (gato com gatos desligados) fica como está.
    if (!isVariantVisible(a.variant, options)) continue
    if (!novas.has(a.variant)) await tx.servicePrice.delete({ where: { id: a.id } })
  }
  for (const r of rows) {
    const existente = atuais.find((a) => a.variant === r.variant)
    if (existente) {
      if (existente.priceCents !== r.priceCents || existente.durationMin !== r.durationMin) {
        await tx.servicePrice.update({ where: { id: existente.id }, data: { priceCents: r.priceCents, durationMin: r.durationMin } })
      }
    } else {
      await tx.servicePrice.create({
        data: { businessId: ctx.businessId, serviceId, variant: r.variant, priceCents: r.priceCents, durationMin: r.durationMin },
      })
    }
  }
  const finais = await tx.servicePrice.findMany({ where: { serviceId } })
  return {
    priceCents: Math.min(...finais.map((f) => f.priceCents)),
    durationMin: Math.min(...finais.map((f) => f.durationMin)),
  }
}

async function reload(tx: TenantTx, id: string): Promise<ServiceView> {
  const row = await tx.service.findUniqueOrThrow({ where: { id }, include: withPrices })
  return toServiceView(row, row.prices)
}

export async function createService(ctx: TenantContext, input: ServiceInput, opts: ServiceWriteOptions = {}): Promise<ServiceView> {
  authorize(ctx, 'manage_catalog')
  const { variantPrices, pricingMode = 'SINGLE', ...data } = parse(createSchema, input)
  const byVariant = pricingMode === 'BY_VARIANT'
  if (!byVariant) {
    if (data.priceCents === undefined) throw validation({ priceCents: 'Informe o preço.' })
    if (data.durationMin === undefined) throw validation({ durationMin: 'Informe a duração.' })
    if (opts.onGrid) await assertOnGrid(ctx, data.durationMin)
  }
  return ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('catalog', ctx.businessId)
    let rows: VariantPriceRow[] = []
    let options: PetOptions = { servesCats: false }
    if (byVariant) {
      options = await assertPriceByVariantAllowed(ctx, tx)
      rows = await checkVariantRows(ctx, variantPrices ?? [], options, opts.onGrid)
    }
    const last = await tx.service.aggregate({ where: { archivedAt: null }, _max: { displayOrder: true } })
    const resumo = byVariant
      ? { priceCents: Math.min(...rows.map((r) => r.priceCents)), durationMin: Math.min(...rows.map((r) => r.durationMin)) }
      : { priceCents: data.priceCents ?? 0, durationMin: data.durationMin ?? 5 }
    const service = await tx.service.create({
      data: { ...data, ...resumo, pricingMode, businessId: ctx.businessId, displayOrder: (last._max.displayOrder ?? 0) + 1 },
    })
    if (byVariant) await writeVariantRows(ctx, tx, service.id, rows, options)
    await audit(ctx, { action: 'service.created', targetType: 'Service', targetId: service.id }, tx)
    return reload(tx, service.id)
  })
}

export async function updateService(
  ctx: TenantContext,
  id: string,
  input: Partial<ServiceInput>,
  opts: ServiceWriteOptions = {},
): Promise<ServiceView> {
  authorize(ctx, 'manage_catalog')
  const { variantPrices, pricingMode, ...data } = definedOnly(parse(updateSchema, input))
  const current = await loadService(ctx, id)
  const mode = pricingMode ?? current.pricingMode
  const toSingle = mode === 'SINGLE' && current.pricingMode === 'BY_VARIANT'
  const toVariant = mode === 'BY_VARIANT' && current.pricingMode === 'SINGLE'
  // A grade só vale para uma duração nova: editar o nome de quem ficou fora da grade (a conta mudou o passo) segue possível.
  if (opts.onGrid && mode === 'SINGLE' && (toSingle || data.durationMin !== current.durationMin)) await assertOnGrid(ctx, data.durationMin)
  if (current.archivedAt !== null) throw archivedConflict()
  if (toSingle) {
    if (data.priceCents === undefined) throw validation({ priceCents: 'Informe o preço único.' })
    if (data.durationMin === undefined) throw validation({ durationMin: 'Informe a duração única.' })
  }
  if (toVariant && variantPrices === undefined) throw validation({ variantPrices: 'Preencha o preço de pelo menos um porte.' })
  const fields = [...Object.keys(data), ...(pricingMode !== undefined ? ['pricingMode'] : []), ...(variantPrices !== undefined ? ['variantPrices'] : [])]
  if (mode === 'BY_VARIANT') {
    // Com preço por porte, as colunas são o resumo das linhas: o que vier no pedido é ignorado.
    delete data.priceCents
    delete data.durationMin
  }
  if (fields.length === 0) return getService(ctx, id)
  try {
    return await ctx.db.$transaction(async (tx) => {
      await tx.$lockKey('catalog', ctx.businessId)
      const patch: Prisma.ServiceUncheckedUpdateInput = { ...data }
      if (pricingMode !== undefined) patch.pricingMode = pricingMode
      if (mode === 'BY_VARIANT' && (variantPrices !== undefined || pricingMode !== undefined)) {
        const options = await assertPriceByVariantAllowed(ctx, tx)
        if (variantPrices !== undefined) {
          const rows = await checkVariantRows(ctx, variantPrices, options, opts.onGrid)
          Object.assign(patch, await writeVariantRows(ctx, tx, id, rows, options))
        }
      }
      if (toSingle) await tx.servicePrice.deleteMany({ where: { serviceId: id } })
      await tx.service.update({ where: { id }, data: patch })
      await audit(ctx, { action: 'service.updated', targetType: 'Service', targetId: id, metadata: { fields } }, tx)
      return reload(tx, id)
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

export async function archiveService(ctx: TenantContext, id: string): Promise<void> {
  authorize(ctx, 'manage_catalog')
  const current = await loadService(ctx, id)
  if (current.archivedAt !== null) return
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.service.update({ where: { id }, data: { archivedAt: ctx.clock() } })
      await audit(ctx, { action: 'service.archived', targetType: 'Service', targetId: id }, tx)
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

/** O serviço restaurado entra no fim da lista. */
export async function restoreService(ctx: TenantContext, id: string): Promise<ServiceView> {
  authorize(ctx, 'manage_catalog')
  const current = await loadService(ctx, id)
  if (current.archivedAt === null) return getService(ctx, id)
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.$lockKey('catalog', ctx.businessId)
      const last = await tx.service.aggregate({ where: { archivedAt: null }, _max: { displayOrder: true } })
      await tx.service.update({
        where: { id },
        data: { archivedAt: null, displayOrder: (last._max.displayOrder ?? 0) + 1 },
      })
      await audit(ctx, { action: 'service.restored', targetType: 'Service', targetId: id }, tx)
    })
    return getService(ctx, id)
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

/**
 * A lista precisa ter exatamente os serviços não arquivados da conta, cada um uma vez. A ordem é gravada sob a trava do
 * catálogo e as linhas são atualizadas em ordem de id: duas pessoas ordenando ao mesmo tempo se enfileiram (vale a última
 * lista inteira), sem impasse no banco e sem posição repetida.
 */
export async function reorderServices(ctx: TenantContext, orderedIds: string[]): Promise<void> {
  authorize(ctx, 'manage_catalog')
  const { orderedIds: ids } = parse(reorderSchema, { orderedIds })
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('catalog', ctx.businessId)
    await writeOrder(ctx, tx, ids)
  })
}

async function writeOrder(ctx: TenantContext, tx: TenantTx, ids: string[]): Promise<void> {
  const existing = await tx.service.findMany({ where: { archivedAt: null }, select: { id: true } })
  const expected = new Set(existing.map((s) => s.id))
  const received = new Set(ids)
  const exact = received.size === ids.length && received.size === expected.size && ids.every((x) => expected.has(x))
  if (!exact) {
    throw new DomainError(
      'validation',
      'A lista de serviços está desatualizada. Recarregue a página e ordene de novo.',
      { fields: { orderedIds: 'Envie todos os serviços não arquivados, cada um uma vez.' } },
    )
  }
  if (ids.length === 0) return
  const posicao = new Map(ids.map((id, index) => [id, index + 1]))
  for (const id of [...ids].sort()) await tx.service.update({ where: { id }, data: { displayOrder: posicao.get(id) ?? 0 } })
  await audit(ctx, { action: 'service.reordered', targetType: 'Service', metadata: { count: ids.length } }, tx)
}

/** Sobe ou desce um serviço uma posição, lendo a lista sob a trava (dois cliques seguidos de pessoas diferentes somam). */
export async function moveService(ctx: TenantContext, id: string, direction: 'up' | 'down'): Promise<void> {
  authorize(ctx, 'manage_catalog')
  if (!idSchema.safeParse(id).success) throw notFound()
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('catalog', ctx.businessId)
    const lista = await tx.service.findMany({
      where: { archivedAt: null },
      select: { id: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    })
    const ids = lista.map((s) => s.id)
    const i = ids.indexOf(id)
    if (i < 0) throw notFound()
    const j = direction === 'up' ? i - 1 : i + 1
    const vizinho = ids[j]
    if (vizinho !== undefined) {
      ids[j] = id
      ids[i] = vizinho
    }
    await writeOrder(ctx, tx, ids)
  })
}
