import type { TenantContext } from '@/server/auth/actor'
import type { Service } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { definedOnly, isCustomer } from '@/server/domain/input'
import { authorize, DomainError, isRecordNotFound, orNotFound, parse, z } from '@/server/domain/errors'

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
}

export type ServiceInput = {
  name: string
  description?: string | null
  icon?: string
  priceCents: number
  durationMin: number
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

const createSchema = z.object({
  name: serviceFields.name,
  description: serviceFields.description.optional(),
  icon: serviceFields.icon.optional(),
  priceCents: serviceFields.priceCents,
  durationMin: serviceFields.durationMin,
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

export function toServiceView(service: Service): ServiceView {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    icon: service.icon,
    priceCents: service.priceCents,
    durationMin: service.durationMin,
    rewardPoints: service.rewardPoints,
    clubOnly: service.clubOnly,
    active: service.active,
    displayOrder: service.displayOrder,
    archived: service.archivedAt !== null,
  }
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Serviço não encontrado.')
}

async function loadService(ctx: TenantContext, id: string): Promise<Service> {
  if (!idSchema.safeParse(id).success) throw notFound()
  const service = orNotFound(await ctx.db.service.findUnique({ where: { id } }), 'Serviço')
  if (isCustomer(ctx) && (!service.active || service.archivedAt !== null)) throw notFound()
  return service
}

function archivedConflict(): DomainError {
  return new DomainError('conflict', 'Este serviço está arquivado. Restaure o serviço antes de alterá-lo.')
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
  })
  return services.map(toServiceView)
}

export async function getService(ctx: TenantContext, id: string): Promise<ServiceView> {
  return toServiceView(await loadService(ctx, id))
}

export async function createService(ctx: TenantContext, input: ServiceInput): Promise<ServiceView> {
  authorize(ctx, 'manage_catalog')
  const data = parse(createSchema, input)
  const created = await ctx.db.$transaction(async (tx) => {
    const last = await tx.service.aggregate({ where: { archivedAt: null }, _max: { displayOrder: true } })
    const service = await tx.service.create({
      data: { ...data, businessId: ctx.businessId, displayOrder: (last._max.displayOrder ?? 0) + 1 },
    })
    await audit(ctx, { action: 'service.created', targetType: 'Service', targetId: service.id }, tx)
    return service
  })
  return toServiceView(created)
}

export async function updateService(
  ctx: TenantContext,
  id: string,
  input: Partial<ServiceInput>,
): Promise<ServiceView> {
  authorize(ctx, 'manage_catalog')
  const data = definedOnly(parse(updateSchema, input))
  const current = await loadService(ctx, id)
  if (current.archivedAt !== null) throw archivedConflict()
  const fields = Object.keys(data)
  if (fields.length === 0) return toServiceView(current)
  try {
    const updated = await ctx.db.$transaction(async (tx) => {
      const service = await tx.service.update({ where: { id }, data })
      await audit(
        ctx,
        { action: 'service.updated', targetType: 'Service', targetId: id, metadata: { fields } },
        tx,
      )
      return service
    })
    return toServiceView(updated)
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
  if (current.archivedAt === null) return toServiceView(current)
  try {
    const restored = await ctx.db.$transaction(async (tx) => {
      const last = await tx.service.aggregate({ where: { archivedAt: null }, _max: { displayOrder: true } })
      const service = await tx.service.update({
        where: { id },
        data: { archivedAt: null, displayOrder: (last._max.displayOrder ?? 0) + 1 },
      })
      await audit(ctx, { action: 'service.restored', targetType: 'Service', targetId: id }, tx)
      return service
    })
    return toServiceView(restored)
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

/** A lista precisa ter exatamente os serviços não arquivados da conta, cada um uma vez. */
export async function reorderServices(ctx: TenantContext, orderedIds: string[]): Promise<void> {
  authorize(ctx, 'manage_catalog')
  const { orderedIds: ids } = parse(reorderSchema, { orderedIds })
  await ctx.db.$transaction(async (tx) => {
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
    for (const [index, id] of ids.entries()) {
      await tx.service.update({ where: { id }, data: { displayOrder: index + 1 } })
    }
    await audit(ctx, { action: 'service.reordered', targetType: 'Service', metadata: { count: ids.length } }, tx)
  })
}
