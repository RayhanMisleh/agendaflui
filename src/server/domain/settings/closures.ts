import type { TenantContext } from '@/server/auth/actor'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { can } from '@/server/auth/capabilities'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, isRecordNotFound, orNotFound, parse, z } from '@/server/domain/errors'
import { OPEN_STATUSES } from '@/server/domain/scheduling/status'
import { compareLocalDates, daysBetween, dbDateToLocal, isLocalDate, localDayRange, localToDbDate, todayIn } from '@/server/time'

/** Fechamento como o domínio de agenda o usa (com o motivo sempre). Telas e rotas usam `listClosuresFor`. */
export type ClosureRow = { id: string; startDate: string; endDate: string; reason: string | null }

/** Fechamento para quem olha: `label` pronto ("24/12/2026 a 26/12/2026"); `reason` só vem para quem gerencia as configurações. */
export type ClosureView = { id: string; startDate: string; endDate: string; label: string; reason?: string | null }

/** Fechamento recém-criado, com quantos agendamentos pendentes ou confirmados da conta caem nos dias dele (não os cancela). */
export type CreatedClosure = ClosureRow & { affectedAppointments: number }

const MAX_CLOSURE_DAYS = 366
const MAX_LIST_DAYS = 400

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

const previewSchema = z.object({ startDate: localDate, endDate: localDate })

const idSchema = z.uuid()

function parseClosurePeriod<T extends { startDate: string; endDate: string }>(i: unknown, schema: z.ZodType<T>): T {
  const data = parse(schema, i)
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
  return data
}

/** Agendamentos pendentes ou confirmados da conta que tocam os dias (datas locais, no fuso da conta). */
function countAffected(ctx: TenantContext, db: TenantClient | TenantTx, p: { startDate: string; endDate: string }): Promise<number> {
  return db.appointment.count({
    where: {
      status: { in: [...OPEN_STATUSES] },
      startsAt: { lt: localDayRange(p.endDate, ctx.timeZone).end },
      endsAt: { gt: localDayRange(p.startDate, ctx.timeZone).start },
    },
  })
}

/** "AAAA-MM-DD" → "DD/MM/AAAA", sem passar por `Date`. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

const viewQuerySchema = z.object({ from: localDate, to: localDate })

/**
 * A única leitura de fechamentos para telas e rotas. Qualquer pessoa da equipe lê; o `reason` só chega a quem pode
 * gerenciar as configurações. O intervalo pedido tem no máximo 400 dias.
 */
export async function listClosuresFor(ctx: TenantContext, q: { from: string; to: string }): Promise<ClosureView[]> {
  authorize(ctx, 'view_dashboard')
  const { from, to } = parse(viewQuerySchema, q)
  if (daysBetween(from, to) + 1 > MAX_LIST_DAYS) {
    throw new DomainError('validation', `Consulte no máximo ${MAX_LIST_DAYS} dias por vez.`, {
      fields: { to: `O intervalo pode ter até ${MAX_LIST_DAYS} dias.` },
    })
  }
  const seesReason = can(ctx.actor, 'manage_settings')
  const rows = await listClosures(ctx, { from, to })
  return rows.map((r) => ({
    id: r.id,
    startDate: r.startDate,
    endDate: r.endDate,
    label: r.startDate === r.endDate ? dayLabel(r.startDate) : `${dayLabel(r.startDate)} a ${dayLabel(r.endDate)}`,
    ...(seesReason ? { reason: r.reason } : {}),
  }))
}

/** Quantos agendamentos pendentes ou confirmados um fechamento nesses dias atingiria; não grava nada. */
export async function previewClosure(ctx: TenantContext, i: { startDate: string; endDate: string }): Promise<{ affectedAppointments: number }> {
  authorize(ctx, 'manage_settings')
  const data = parseClosurePeriod(i, previewSchema)
  return { affectedAppointments: await countAffected(ctx, ctx.db, data) }
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Fechamento não encontrado.')
}

function toView(row: { id: string; startDate: Date; endDate: Date; reason: string | null }): ClosureRow {
  return { id: row.id, startDate: dbDateToLocal(row.startDate), endDate: dbDateToLocal(row.endDate), reason: row.reason }
}

/** Uso interno do domínio (disponibilidade e agenda). Sem filtro: os que terminam hoje (fuso da conta) ou depois. Com `from`/`to`: os que tocam o intervalo. */
export async function listClosures(ctx: TenantContext, q: { from?: string; to?: string } = {}): Promise<ClosureRow[]> {
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
): Promise<CreatedClosure> {
  authorize(ctx, 'manage_settings')
  const data = parseClosurePeriod(i, createSchema)
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
    const affectedAppointments = await countAffected(ctx, tx, data)
    return { closure, affectedAppointments }
  })
  return { ...toView(created.closure), affectedAppointments: created.affectedAppointments }
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
export async function isClosedOn(
  ctx: TenantContext,
  date: string,
  db: TenantClient | TenantTx = ctx.db,
): Promise<boolean> {
  const { date: day } = parse(z.object({ date: localDate }), { date })
  const dbDay = localToDbDate(day)
  const hit = await db.businessClosure.findFirst({
    where: { startDate: { lte: dbDay }, endDate: { gte: dbDay } },
    select: { id: true },
  })
  return hit !== null
}
