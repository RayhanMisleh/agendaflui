import type { TenantContext } from '@/server/auth/actor'
import type { PartyType } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { DomainError, isRecordNotFound, orNotFound, parse, z } from '@/server/domain/errors'
import { assertCanManageProfessional, assertCanReadSchedule } from '@/server/domain/team/professionals'
import { compareLocalDates, daysBetween, isLocalDate, localDayRange, minutesBetween } from '@/server/time'

export type TimeBlockView = {
  id: string
  professionalId: string
  startsAt: Date
  endsAt: Date
  reason: string | null
}

const MAX_BLOCK_DAYS = 60
const MAX_QUERY_DAYS = 92

const localDate = z.string().refine(isLocalDate, 'Use uma data válida no formato AAAA-MM-DD.')

const querySchema = z.object({ professionalId: z.string(), from: localDate, to: localDate })

const createSchema = z.object({
  professionalId: z.string(),
  startsAt: z.date('Informe o início do bloqueio.'),
  endsAt: z.date('Informe o fim do bloqueio.'),
  reason: z
    .string()
    .trim()
    .max(200, 'Use até 200 caracteres.')
    .transform((texto) => (texto === '' ? null : texto))
    .nullable()
    .optional(),
})

const idSchema = z.uuid()

function notFound(): DomainError {
  return new DomainError('not_found', 'Bloqueio não encontrado.')
}

function toView(row: { id: string; professionalId: string; startsAt: Date; endsAt: Date; reason: string | null }): TimeBlockView {
  return {
    id: row.id,
    professionalId: row.professionalId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reason: row.reason,
  }
}

function creator(ctx: TenantContext): { createdByType: PartyType; createdById: string | null } {
  const actor = ctx.actor
  switch (actor.kind) {
    case 'member':
      return { createdByType: 'MEMBER', createdById: actor.userId }
    case 'impersonator':
    case 'platform_admin':
      return { createdByType: 'PLATFORM_ADMIN', createdById: actor.adminId }
    case 'customer':
      return { createdByType: 'CUSTOMER', createdById: actor.customerId }
    case 'system':
      return { createdByType: 'SYSTEM', createdById: null }
  }
}

/** Bloqueios que tocam o intervalo de datas locais (inclusive), no fuso da conta. */
export async function listTimeBlocks(
  ctx: TenantContext,
  q: { professionalId: string; from: string; to: string },
): Promise<TimeBlockView[]> {
  const { professionalId, from, to } = parse(querySchema, q)
  await assertCanReadSchedule(ctx, professionalId)
  if (compareLocalDates(from, to) > 0) {
    throw new DomainError('validation', 'A data final deve ser igual ou depois da inicial.', {
      fields: { to: 'Use uma data igual ou depois da inicial.' },
    })
  }
  if (daysBetween(from, to) + 1 > MAX_QUERY_DAYS) {
    throw new DomainError('validation', `Consulte no máximo ${MAX_QUERY_DAYS} dias por vez.`, {
      fields: { to: `O intervalo pode ter até ${MAX_QUERY_DAYS} dias.` },
    })
  }
  const start = localDayRange(from, ctx.timeZone).start
  const end = localDayRange(to, ctx.timeZone).end
  const rows = await ctx.db.timeBlock.findMany({
    where: { professionalId, startsAt: { lt: end }, endsAt: { gt: start } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toView)
}

export async function createTimeBlock(
  ctx: TenantContext,
  i: { professionalId: string; startsAt: Date; endsAt: Date; reason?: string | null },
): Promise<TimeBlockView> {
  const data = parse(createSchema, i)
  await assertCanManageProfessional(ctx, data.professionalId)
  if (data.startsAt.getTime() >= data.endsAt.getTime()) {
    throw new DomainError('validation', 'O fim do bloqueio deve ser depois do início.', {
      fields: { endsAt: 'Escolha um fim depois do início.' },
    })
  }
  if (minutesBetween(data.startsAt, data.endsAt) > MAX_BLOCK_DAYS * 1440) {
    throw new DomainError('validation', `Um bloqueio pode ter no máximo ${MAX_BLOCK_DAYS} dias.`, {
      fields: { endsAt: `Use um período de até ${MAX_BLOCK_DAYS} dias.` },
    })
  }
  const created = await ctx.db.$transaction(async (tx) => {
    const block = await tx.timeBlock.create({
      data: {
        businessId: ctx.businessId,
        professionalId: data.professionalId,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        reason: data.reason ?? null,
        ...creator(ctx),
      },
    })
    await audit(
      ctx,
      {
        action: 'time_block.created',
        targetType: 'TimeBlock',
        targetId: block.id,
        metadata: { professionalId: data.professionalId },
      },
      tx,
    )
    return block
  })
  return toView(created)
}

export async function deleteTimeBlock(ctx: TenantContext, id: string): Promise<void> {
  if (!idSchema.safeParse(id).success) throw notFound()
  const block = orNotFound(await ctx.db.timeBlock.findUnique({ where: { id } }), 'Bloqueio')
  await assertCanManageProfessional(ctx, block.professionalId)
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.timeBlock.delete({ where: { id } })
      await audit(
        ctx,
        {
          action: 'time_block.deleted',
          targetType: 'TimeBlock',
          targetId: id,
          metadata: { professionalId: block.professionalId },
        },
        tx,
      )
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}
