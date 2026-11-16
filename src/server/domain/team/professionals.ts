import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { Prisma } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { definedOnly, isCustomer } from '@/server/domain/input'
import { authorize, DomainError, isRecordNotFound, isUniqueViolation, orNotFound, parse, z } from '@/server/domain/errors'
import { OPEN_STATUSES } from '@/server/domain/scheduling/status'
import { publicUploadUrl, uploadUrl } from '@/server/storage/images'

export type ProfessionalView = {
  id: string
  name: string
  bio: string | null
  avatarUrl: string | null
  serviceIds: string[]
  /** Os cinco campos abaixo são da equipe: o cliente do app e o visitante só recebem os de cima (as chaves nem existem). */
  commissionBps?: number
  active?: boolean
  displayOrder?: number
  archived?: boolean
  membershipId?: string | null
}

export type ProfessionalInput = {
  name: string
  bio?: string | null
  commissionBps?: number
  active?: boolean
  membershipId?: string | null
  serviceIds?: string[]
}

const professionalFields = {
  name: z.string().trim().min(1, 'Informe o nome do profissional.').max(80, 'Use até 80 caracteres.'),
  bio: z
    .string()
    .trim()
    .max(500, 'Use até 500 caracteres.')
    .transform((texto) => (texto === '' ? null : texto))
    .nullable(),
  commissionBps: z
    .number()
    .int('Informe a comissão em pontos-base, sem fração.')
    .min(0, 'A comissão não pode ser negativa.')
    .max(10_000, 'A comissão máxima é de 100% (10000).'),
  active: z.boolean(),
  membershipId: z.uuid('Escolha um acesso válido da equipe.').nullable(),
  serviceIds: z.array(z.uuid('Escolha serviços válidos.')).max(200, 'Há serviços demais na lista.'),
}

const createSchema = z.object({
  name: professionalFields.name,
  bio: professionalFields.bio.optional(),
  commissionBps: professionalFields.commissionBps.optional(),
  active: professionalFields.active.optional(),
  membershipId: professionalFields.membershipId.optional(),
  serviceIds: professionalFields.serviceIds.optional(),
})

const updateSchema = createSchema.partial()

const idSchema = z.uuid()

const listOptionsSchema = z.object({
  includeInactive: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
  serviceIds: z
    .array(z.string())
    .max(10, 'Filtre por no máximo 10 serviços.')
    .refine((ids) => ids.every((id) => idSchema.safeParse(id).success), 'Escolha serviços válidos.')
    .optional(),
})

type ProfessionalRow = Prisma.ProfessionalGetPayload<{
  include: { avatar: true; services: { select: { serviceId: true } } }
}>

const withRelations = { avatar: true, services: { select: { serviceId: true } } } as const

/** A comissão real só aparece para quem gere a equipe (inclui o suporte) e na ficha do próprio profissional. */
function seesCommission(ctx: TenantContext, row: ProfessionalRow, ownId: string | null): boolean {
  if (isCustomer(ctx)) return false
  return can(ctx.actor, 'manage_team') || (ownId !== null && ownId === row.id)
}

function toView(ctx: TenantContext, row: ProfessionalRow, ownId: string | null = null): ProfessionalView {
  const view: ProfessionalView = {
    id: row.id,
    name: row.name,
    bio: row.bio,
    avatarUrl: ctx.channel === 'app' ? publicUploadUrl(row.avatar) : uploadUrl(row.avatar),
    serviceIds: row.services.map((s) => s.serviceId).sort(),
  }
  if (isCustomer(ctx)) return view
  return {
    ...view,
    commissionBps: seesCommission(ctx, row, ownId) ? row.commissionBps : 0,
    active: row.active,
    displayOrder: row.displayOrder,
    archived: row.archivedAt !== null,
    membershipId: row.membershipId,
  }
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Profissional não encontrado.')
}

async function loadRow(ctx: TenantContext, id: string): Promise<ProfessionalRow> {
  if (!idSchema.safeParse(id).success) throw notFound()
  const row = orNotFound(
    await ctx.db.professional.findUnique({ where: { id }, include: withRelations }),
    'Profissional',
  )
  if (isCustomer(ctx) && (!row.active || row.archivedAt !== null)) throw notFound()
  return row
}

type Db = TenantClient | TenantTx

/** Os serviços precisam existir na conta e não estar arquivados. */
async function assertServicesExist(db: Db, serviceIds: string[]): Promise<void> {
  const unique = [...new Set(serviceIds)]
  if (unique.length === 0) return
  const found = await db.service.count({ where: { id: { in: unique }, archivedAt: null } })
  if (found !== unique.length) {
    throw new DomainError('validation', 'Algum serviço escolhido não existe ou está arquivado. Escolha de novo.', {
      fields: { serviceIds: 'Escolha apenas serviços ativos da conta.' },
    })
  }
}

function membershipTaken(): DomainError {
  return new DomainError('conflict', 'Este acesso já está ligado a outro profissional. Escolha outro acesso.', {
    reason: 'membership_taken',
    fields: { membershipId: 'Este acesso já está ligado a outro profissional.' },
  })
}

/** O vínculo precisa ser ativo, da conta e sem outro profissional (arquivar solta o vínculo). */
async function assertMembershipFree(db: Db, membershipId: string, selfId: string | null): Promise<void> {
  const membership = await db.membership.findFirst({ where: { id: membershipId, active: true } })
  if (!membership) {
    throw new DomainError('validation', 'Este acesso não existe ou está desativado. Escolha outro.', {
      fields: { membershipId: 'Escolha um acesso ativo da equipe.' },
    })
  }
  const taken = await db.professional.findFirst({
    where: { membershipId, ...(selfId ? { id: { not: selfId } } : {}) },
  })
  if (taken) throw membershipTaken()
}

async function replaceServices(tx: TenantTx, ctx: TenantContext, professionalId: string, serviceIds: string[]) {
  await tx.professionalService.deleteMany({ where: { professionalId } })
  const unique = [...new Set(serviceIds)]
  if (unique.length > 0) {
    await tx.professionalService.createMany({
      data: unique.map((serviceId) => ({ businessId: ctx.businessId, professionalId, serviceId })),
    })
  }
}

export async function listProfessionals(
  ctx: TenantContext,
  opts: { includeInactive?: boolean; includeArchived?: boolean; serviceIds?: string[] } = {},
): Promise<ProfessionalView[]> {
  const { includeInactive, includeArchived, serviceIds } = parse(listOptionsSchema, opts)
  const customer = isCustomer(ctx)
  const rows = await ctx.db.professional.findMany({
    where: {
      ...(customer || !includeInactive ? { active: true } : {}),
      ...(customer || !includeArchived ? { archivedAt: null } : {}),
      ...(serviceIds && serviceIds.length > 0
        ? { AND: [...new Set(serviceIds)].map((serviceId) => ({ services: { some: { serviceId } } })) }
        : {}),
    },
    include: withRelations,
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  })
  const ownId = await ownProfessionalId(ctx)
  return rows.map((row) => toView(ctx, row, ownId))
}

export async function getProfessional(ctx: TenantContext, id: string): Promise<ProfessionalView> {
  const row = await loadRow(ctx, id)
  return toView(ctx, row, await ownProfessionalId(ctx))
}

export async function createProfessional(ctx: TenantContext, input: ProfessionalInput): Promise<ProfessionalView> {
  authorize(ctx, 'manage_team')
  const { serviceIds, name, ...optional } = parse(createSchema, input)
  const data = { name, ...definedOnly(optional) }
  const id = await ctx.db.$transaction(async (tx) => {
    let linked: string[]
    if (serviceIds === undefined) {
      linked = (await tx.service.findMany({ where: { archivedAt: null }, select: { id: true } })).map((s) => s.id)
    } else {
      await assertServicesExist(tx, serviceIds)
      linked = serviceIds
    }
    if (data.membershipId) await assertMembershipFree(tx, data.membershipId, null)
    const last = await tx.professional.aggregate({ where: { archivedAt: null }, _max: { displayOrder: true } })
    const professional = await tx.professional.create({
      data: { ...data, businessId: ctx.businessId, displayOrder: (last._max.displayOrder ?? 0) + 1 },
    })
    await replaceServices(tx, ctx, professional.id, linked)
    await audit(ctx, { action: 'professional.created', targetType: 'Professional', targetId: professional.id }, tx)
    return professional.id
  }).catch((err: unknown) => {
    if (data.membershipId && isUniqueViolation(err)) throw membershipTaken()
    throw err
  })
  return toView(ctx, await loadRow(ctx, id))
}

export async function updateProfessional(
  ctx: TenantContext,
  id: string,
  input: Partial<ProfessionalInput>,
): Promise<ProfessionalView> {
  authorize(ctx, 'manage_team')
  const { serviceIds, ...data } = definedOnly(parse(updateSchema, input))
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) {
    throw new DomainError('conflict', 'Este profissional está arquivado. Não é possível alterá-lo.')
  }
  const fields = [...Object.keys(data), ...(serviceIds !== undefined ? ['serviceIds'] : [])]
  if (fields.length === 0) return toView(ctx, current)
  try {
    await ctx.db.$transaction(async (tx) => {
      if (serviceIds !== undefined) await assertServicesExist(tx, serviceIds)
      if (data.membershipId) await assertMembershipFree(tx, data.membershipId, id)
      if (Object.keys(data).length > 0) await tx.professional.update({ where: { id }, data })
      if (serviceIds !== undefined) await replaceServices(tx, ctx, id, serviceIds)
      await audit(
        ctx,
        { action: 'professional.updated', targetType: 'Professional', targetId: id, metadata: { fields } },
        tx,
      )
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    if (data.membershipId && isUniqueViolation(err)) throw membershipTaken()
    throw err
  }
  return toView(ctx, await loadRow(ctx, id))
}

export async function archiveProfessional(ctx: TenantContext, id: string): Promise<void> {
  authorize(ctx, 'manage_team')
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  try {
    await ctx.db.$transaction(async (tx) => {
      // A trava serializa com as marcações; atendimento em andamento (ainda não terminou) também impede.
      await tx.$lockKey('professional', id)
      const count = await tx.appointment.count({
        where: { professionalId: id, status: { in: [...OPEN_STATUSES] }, endsAt: { gt: ctx.clock() } },
      })
      if (count > 0) {
        const quantos = count === 1 ? 'Há 1 agendamento futuro' : `Há ${count} agendamentos futuros`
        throw new DomainError(
          'conflict',
          `${quantos} com este profissional. Cancele ou remaneje os agendamentos antes de arquivar.`,
          { reason: 'has_future_appointments', details: { count } },
        )
      }
      await tx.professional.update({ where: { id }, data: { archivedAt: ctx.clock(), membershipId: null } })
      await audit(ctx, { action: 'professional.archived', targetType: 'Professional', targetId: id }, tx)
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

/** Tira a ficha do arquivo e a põe no fim da ordem, sem vínculo de acesso (o acesso é ligado de novo na edição). */
export async function restoreProfessional(ctx: TenantContext, id: string): Promise<ProfessionalView> {
  authorize(ctx, 'manage_team')
  const current = await loadRow(ctx, id)
  if (current.archivedAt === null) return toView(ctx, current)
  try {
    await ctx.db.$transaction(async (tx) => {
      const last = await tx.professional.aggregate({ where: { archivedAt: null }, _max: { displayOrder: true } })
      await tx.professional.update({
        where: { id },
        data: { archivedAt: null, membershipId: null, displayOrder: (last._max.displayOrder ?? 0) + 1 },
      })
      await audit(ctx, { action: 'professional.restored', targetType: 'Professional', targetId: id }, tx)
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
  return toView(ctx, await loadRow(ctx, id))
}

/** Profissional (não arquivado) ligado ao vínculo do ator; `null` para quem não é membro ou não tem ficha. */
export async function ownProfessionalId(ctx: TenantContext): Promise<string | null> {
  if (ctx.actor.kind !== 'member') return null
  const own = await ctx.db.professional.findFirst({
    where: { membershipId: ctx.actor.membershipId, archivedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  return own?.id ?? null
}

/** Passa com `manage_team`, ou para o próprio profissional com `manage_own_availability`. */
export async function assertCanManageProfessional(ctx: TenantContext, professionalId: string): Promise<void> {
  if (!idSchema.safeParse(professionalId).success) throw notFound()
  orNotFound(await ctx.db.professional.findUnique({ where: { id: professionalId }, select: { id: true } }), 'Profissional')
  if (can(ctx.actor, 'manage_team')) return
  if (can(ctx.actor, 'manage_own_availability') && (await ownProfessionalId(ctx)) === professionalId) return
  throw new DomainError('forbidden', 'Você não tem permissão para alterar a agenda deste profissional.')
}

/** Escrita de expediente ou bloqueio: como `assertCanManageProfessional`, e a ficha não pode estar arquivada. */
export async function assertCanWriteSchedule(ctx: TenantContext, professionalId: string): Promise<void> {
  await assertCanManageProfessional(ctx, professionalId)
  const row = orNotFound(
    await ctx.db.professional.findUnique({ where: { id: professionalId }, select: { archivedAt: true } }),
    'Profissional',
  )
  if (row.archivedAt !== null) {
    throw new DomainError('conflict', 'Este profissional está arquivado. Restaure a ficha antes de alterar a agenda.')
  }
}

/** Leitura da escala (expediente e bloqueios): livre para a equipe, nunca para o cliente. */
export async function assertCanReadSchedule(ctx: TenantContext, professionalId: string): Promise<void> {
  if (isCustomer(ctx)) throw new DomainError('forbidden', 'Você não tem permissão para ver esta agenda.')
  if (!idSchema.safeParse(professionalId).success) throw notFound()
  orNotFound(await ctx.db.professional.findUnique({ where: { id: professionalId }, select: { id: true } }), 'Profissional')
}
