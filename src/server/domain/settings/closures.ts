import type { TenantContext } from '@/server/auth/actor'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, isRecordNotFound, orNotFound, parse, z } from '@/server/domain/errors'
import { compareLocalDates, daysBetween, dbDateToLocal, isLocalDate, localToDbDate, todayIn } from '@/server/time'

export type ClosureView = { id: string; startDate: string; endDate: string; reason: string | null }

const MAX_CLOSURE_DAYS = 366

const localDate = z.string().refine(isLocalDate, 'Use uma data válida no formato AAAA-MM-DD.')

const createSchema = z.object({
  startDate: localDate,
  endDate: localDate,
  reason: z
    .string()
    .trim()
    .max(200, 'Use até 200 caracteres.')
    .transform((texto) => (texto === '' ? null : texto))
    .nullable()
    .optional(),
})

const querySchema = z.object({ from: localDate.optional(), to: localDate.optional() })

const idSchema = z.uuid()

function notFound(): DomainError {
  return new DomainError('not_found', 'Fechamento não encontrado.')
}

function toView(row: { id: string; startDate: Date; endDate: Date; reason: string | null }): ClosureView {
  return { id: row.id, startDate: dbDateToLocal(row.startDate), endDate: dbDateToLocal(row.endDate), reason: row.reason }
}

/** Sem filtro: os que terminam hoje (fuso da conta) ou depois. Com `from`/`to`: os que tocam o intervalo. */
export async function listClosures(ctx: TenantContext, q: { from?: string; to?: string } = {}): Promise<ClosureView[]> {
  const { from, to } = parse(querySchema, q)
  if (from && to && compareLocalDates(from, to) > 0) {
    throw new DomainError('validation', 'A data final deve ser igual ou depois da inicial.', {
      fields: { to: 'Use uma data igual ou depois da inicial.' },
    })
  }
  const lowerBound = from ?? (to ? undefined : todayIn(ctx.timeZone, ctx.clock()))
  const rows = await ctx.db.businessClosure.findMany({
    where: {
      ...(lowerBound ? { endDate: { gte: localToDbDate(lowerBound) } } : {}),
      ...(to ? { startDate: { lte: localToDbDate(to) } } : {}),
    },
    orderBy: [{ startDate: 'asc' }, { endDate: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toView)
}

export async function createClosure(
  ctx: TenantContext,
  i: { startDate: string; endDate: string; reason?: string | null },
): Promise<ClosureView> {
  authorize(ctx, 'manage_settings')
  const data = parse(createSchema, i)
  if (compareLocalDates(data.startDate, data.endDate) > 0) {
    throw new DomainError('validation', 'A data final deve ser igual ou depois da inicial.', {
      fields: { endDate: 'Use uma data igual ou depois da inicial.' },
    })
  }
  if (daysBetween(data.startDate, data.endDate) + 1 > MAX_CLOSURE_DAYS) {
    throw new DomainError('validation', `Um fechamento pode ter no máximo ${MAX_CLOSURE_DAYS} dias.`, {
      fields: { endDate: `Use um período de até ${MAX_CLOSURE_DAYS} dias.` },
    })
  }
  const created = await ctx.db.$transaction(async (tx) => {
    const closure = await tx.businessClosure.create({
      data: {
        businessId: ctx.businessId,
        startDate: localToDbDate(data.startDate),
        endDate: localToDbDate(data.endDate),
        reason: data.reason ?? null,
      },
    })
    await audit(
      ctx,
      {
        action: 'closure.created',
        targetType: 'BusinessClosure',
        targetId: closure.id,
        metadata: { startDate: data.startDate, endDate: data.endDate },
      },
      tx,
    )
    return closure
  })
  return toView(created)
}

export async function deleteClosure(ctx: TenantContext, id: string): Promise<void> {
  authorize(ctx, 'manage_settings')
  if (!idSchema.safeParse(id).success) throw notFound()
  const closure = orNotFound(await ctx.db.businessClosure.findUnique({ where: { id } }), 'Fechamento')
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.businessClosure.delete({ where: { id } })
      await audit(
        ctx,
        {
          action: 'closure.deleted',
          targetType: 'BusinessClosure',
          targetId: id,
          metadata: { startDate: dbDateToLocal(closure.startDate), endDate: dbDateToLocal(closure.endDate) },
        },
        tx,
      )
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

/** A data local cai dentro de algum fechamento da conta (primeiro e último dia incluídos). */
export async function isClosedOn(ctx: TenantContext, date: string): Promise<boolean> {
  const { date: day } = parse(z.object({ date: localDate }), { date })
  const dbDay = localToDbDate(day)
  const hit = await ctx.db.businessClosure.findFirst({
    where: { startDate: { lte: dbDay }, endDate: { gte: dbDay } },
    select: { id: true },
  })
  return hit !== null
}
