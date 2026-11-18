import type { TenantContext } from '@/server/auth/actor'
import type { LoyaltyEntryKind, LoyaltyTransaction, Prisma } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { party } from '@/server/domain/scheduling/appointment-view'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { formatDateTime, fromEpochMs } from '@/server/time'

export type LoyaltyEntryView = {
  id: string
  kind: LoyaltyEntryKind
  /** Com sinal: crédito positivo, débito negativo. */
  points: number
  reason: string | null
  appointmentId: string | null
  redemptionId: string | null
  createdAt: Date
  /** Rótulo de `createdAt` no fuso da conta. */
  createdLabel: string
}

type Db = TenantClient | TenantTx

const MAX_ADJUST = 100_000
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

const idSchema = z.uuid()

const adjustSchema = z.object({
  customerId: z.uuid('Escolha um cliente válido.'),
  points: z
    .number('Informe a quantidade de pontos.')
    .int('Informe uma quantidade inteira, sem fração.')
    .min(-MAX_ADJUST, 'Use no máximo 100.000 pontos por ajuste.')
    .max(MAX_ADJUST, 'Use no máximo 100.000 pontos por ajuste.')
    .refine((v) => v !== 0, 'Informe uma quantidade diferente de zero.'),
  reason: z
    .string('Informe o motivo do ajuste.')
    .trim()
    .min(3, 'Explique o motivo com pelo menos 3 caracteres.')
    .max(200, 'Use até 200 caracteres no motivo.'),
  requestId: z.uuid('Identificador do pedido inválido. Recarregue a página.').optional(),
})

const listSchema = z.object({
  cursor: z.string().max(1024).optional(),
  limit: z
    .number()
    .int('Informe o limite como número inteiro.')
    .min(1, 'O limite mínimo é 1.')
    .max(MAX_LIMIT, `O limite máximo é ${MAX_LIMIT}.`)
    .optional(),
})

/** O saldo é SEMPRE a soma das linhas do cliente: não existe coluna de saldo. */
export async function getBalance(db: Db, customerId: string): Promise<number> {
  const r = await db.loyaltyTransaction.aggregate({ where: { customerId }, _sum: { points: true } })
  return r._sum.points ?? 0
}

/** `5 pontos`, `1 ponto`: o termo da conta, no singular ou no plural. */
export async function pointsLabel(db: Db, businessId: string, n: number): Promise<string> {
  const s = await db.businessSettings.findUnique({ where: { businessId }, select: { termPointsSingular: true, termPointsPlural: true } })
  const term = Math.abs(n) === 1 ? (s?.termPointsSingular ?? 'ponto') : (s?.termPointsPlural ?? 'pontos')
  return `${n} ${term}`
}

export function entryView(ctx: TenantContext, row: LoyaltyTransaction): LoyaltyEntryView {
  return {
    id: row.id,
    kind: row.kind,
    points: row.points,
    // O motivo do ajuste é da equipe: o cliente vê só o rótulo genérico.
    reason: ctx.actor.kind === 'customer' && row.kind === 'ADJUST' ? 'Ajuste' : row.reason,
    appointmentId: row.appointmentId,
    redemptionId: row.redemptionId,
    createdAt: row.createdAt,
    createdLabel: formatDateTime(row.createdAt, ctx.timeZone),
  }
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Cliente não encontrado.')
}

/** Trava o cliente e confere que ele existe e está ativo (nem arquivado nem anonimizado). Já deve estar numa transação. */
export async function lockActiveCustomer(tx: TenantTx, customerId: string, what: string): Promise<void> {
  await tx.$lockKey('customer', customerId)
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { archivedAt: true, anonymizedAt: true } })
  if (!customer) throw notFound()
  if (customer.archivedAt !== null || customer.anonymizedAt !== null) {
    throw new DomainError('conflict', `Este cliente está arquivado ou foi removido. ${what}`, { reason: 'customer_inactive' })
  }
}

/** O cliente lê o próprio; a equipe com `view_clients` lê qualquer um da conta. */
async function assertCanRead(ctx: TenantContext, customerId: string): Promise<{ isClubMember: boolean }> {
  if (ctx.actor.kind === 'customer') {
    if (ctx.actor.customerId !== customerId) throw new DomainError('forbidden', 'Você só pode ver os seus próprios pontos.')
  } else {
    authorize(ctx, 'view_clients')
  }
  if (!idSchema.safeParse(customerId).success) throw notFound()
  return orNotFound(await ctx.db.customer.findUnique({ where: { id: customerId }, select: { isClubMember: true } }), 'Cliente')
}

export async function getCustomerLoyalty(ctx: TenantContext, customerId: string): Promise<{ balance: number; clubMember: boolean }> {
  await requireModule(ctx, 'loyalty')
  const customer = await assertCanRead(ctx, customerId)
  return { balance: await getBalance(ctx.db, customerId), clubMember: customer.isClubMember }
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.getTime(), row.id])).toString('base64url')
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const invalid = new DomainError('validation', 'O cursor de paginação é inválido. Recarregue a lista.', { fields: { cursor: 'Cursor inválido.' } })
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isSafeInteger(parsed[0]) && typeof parsed[1] === 'string' && idSchema.safeParse(parsed[1]).success) {
      return { createdAt: fromEpochMs(parsed[0] as number), id: parsed[1] }
    }
  } catch {
    // cai no erro abaixo
  }
  throw invalid
}

/** Extrato do cliente: mais recente primeiro, paginado por cursor `(instante, id)`. */
export async function listLoyaltyEntries(
  ctx: TenantContext,
  customerId: string,
  q: { cursor?: string; limit?: number } = {},
): Promise<{ items: LoyaltyEntryView[]; nextCursor: string | null }> {
  await requireModule(ctx, 'loyalty')
  await assertCanRead(ctx, customerId)
  const { cursor, limit = DEFAULT_LIMIT } = parse(listSchema, q)
  const after = cursor === undefined ? null : decodeCursor(cursor)
  const where: Prisma.LoyaltyTransactionWhereInput = {
    customerId,
    ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
  }
  const rows = await ctx.db.loyaltyTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map((r) => entryView(ctx, r)), nextCursor: rows.length > limit && last ? encodeCursor(last) : null }
}

/**
 * Ajuste manual de pontos (equipe com `manage_loyalty`): motivo obrigatório, sob a trava do cliente. Um ajuste que
 * tiraria pontos e deixaria o saldo negativo é recusado; um ajuste que soma nunca é.
 */
export async function adjustPoints(
  ctx: TenantContext,
  i: { customerId: string; points: number; reason: string; requestId?: string },
): Promise<{ entry: LoyaltyEntryView; balance: number }> {
  await requireModule(ctx, 'loyalty')
  authorize(ctx, 'manage_loyalty')
  const input = parse(adjustSchema, i)
  const by = party(ctx)
  return ctx.db.$transaction(async (tx) => {
    await lockActiveCustomer(tx, input.customerId, 'Restaure o cadastro antes de ajustar pontos.')
    const dedupeKey = `adjust:${input.requestId ?? crypto.randomUUID()}`
    if (input.requestId !== undefined) {
      // Reenvio do mesmo formulário: devolve o ajuste que já foi gravado, sem creditar de novo.
      const previous = await tx.loyaltyTransaction.findFirst({ where: { dedupeKey } })
      if (previous) {
        if (previous.customerId !== input.customerId || previous.points !== input.points || previous.kind !== 'ADJUST') {
          throw new DomainError('conflict', 'Este pedido de ajuste já foi usado com outros dados. Recarregue a página e refaça o ajuste.', { reason: 'idempotency_key_reused' })
        }
        return { entry: entryView(ctx, previous), balance: await getBalance(tx, input.customerId) }
      }
    }
    const before = await getBalance(tx, input.customerId)
    if (input.points < 0 && before + input.points < 0) {
      throw new DomainError(
        'conflict',
        `O saldo do cliente é de ${await pointsLabel(tx, ctx.businessId, before)} e o ajuste tira ${await pointsLabel(tx, ctx.businessId, -input.points)}. O saldo não pode ficar negativo.`,
        { reason: 'insufficient_points', fields: { points: 'O saldo não pode ficar negativo.' } },
      )
    }
    const row = await tx.loyaltyTransaction.create({
      data: {
        businessId: ctx.businessId,
        customerId: input.customerId,
        kind: 'ADJUST',
        points: input.points,
        reason: input.reason,
        dedupeKey,
        createdByType: by.type,
        createdById: by.id,
      },
    })
    await audit(
      ctx,
      { action: 'loyalty.adjusted', targetType: 'Customer', targetId: input.customerId, metadata: { customerId: input.customerId, points: input.points, reason: input.reason } },
      tx,
    )
    return { entry: entryView(ctx, row), balance: before + input.points }
  }, TX_OPTIONS)
}
