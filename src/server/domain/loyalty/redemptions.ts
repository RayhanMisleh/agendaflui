import { createHash } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import type { PartyType, Prisma, PrizeRedemption, RedemptionStatus } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, isUniqueViolation, orNotFound, parse, z } from '@/server/domain/errors'
import { decodeCursor, encodeCursor, getBalance, lockActiveCustomer, pointsLabel } from '@/server/domain/loyalty/ledger'
import { requireModule } from '@/server/domain/modules'
import { party } from '@/server/domain/scheduling/appointment-view'
import { IDEMPOTENCY_TTL_MIN } from '@/server/domain/scheduling/appointments'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { formatDateTime, minutesBetween } from '@/server/time'

export type RedemptionView = {
  id: string
  status: RedemptionStatus
  prize: { id: string; name: string }
  costPoints: number
  customer: { id: string; name: string }
  createdLabel: string
  deliveredLabel: string | null
  canceledLabel: string | null
  cancelReason: string | null
}

type Row = PrizeRedemption & { customer: { id: string; name: string } }
type Db = TenantClient | TenantTx

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
/** Nome do índice único parcial `(business_id, customer_id, idempotency_key)`, criado na migração. */
const IDEMPOTENCY_INDEX = 'prize_redemptions_idempotency_key_key'
const withCustomer = { customer: { select: { id: true, name: true } } } as const
const idSchema = z.uuid()

const redeemSchema = z.object({
  prizeId: z.string('Escolha um prêmio.'),
  customerId: z.uuid('Escolha um cliente válido.').optional(),
  deliverNow: z.boolean().optional(),
  expectedCostPoints: z.number('Informe o custo como número.').int().positive().optional(),
  idempotencyKey: z
    .string('Informe a chave de idempotência como texto.')
    .regex(/^[A-Za-z0-9_-]{1,80}$/, 'Use de 1 a 80 caracteres: letras, números, "-" e "_".')
    .optional(),
})

const cancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(300, 'Use até 300 caracteres no motivo.')
    .transform((t) => (t === '' ? null : t))
    .nullable()
    .optional(),
})

const listSchema = z.object({
  status: z.enum(['PENDING', 'DELIVERED', 'CANCELED'], 'Escolha uma situação válida.').optional(),
  customerId: z.uuid('Escolha um cliente válido.').optional(),
  cursor: z.string().max(1024).optional(),
  limit: z
    .number()
    .int('Informe o limite como número inteiro.')
    .min(1, 'O limite mínimo é 1.')
    .max(MAX_LIMIT, `O limite máximo é ${MAX_LIMIT}.`)
    .optional(),
})

function toView(ctx: TenantContext, row: Row): RedemptionView {
  const label = (d: Date | null) => (d === null ? null : formatDateTime(d, ctx.timeZone))
  return {
    id: row.id,
    status: row.status,
    prize: { id: row.prizeId, name: row.prizeName },
    costPoints: row.costPoints,
    customer: { id: row.customer.id, name: row.customer.name },
    createdLabel: formatDateTime(row.createdAt, ctx.timeZone),
    deliveredLabel: label(row.deliveredAt),
    canceledLabel: label(row.canceledAt),
    cancelReason: row.cancelReason,
  }
}

const notFound = (): DomainError => new DomainError('not_found', 'Resgate não encontrado.')

function invalidTransition(message: string): DomainError {
  return new DomainError('conflict', message, { reason: 'invalid_transition' })
}

async function loadRow(db: Db, id: string): Promise<Row> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await db.prizeRedemption.findUnique({ where: { id }, include: withCustomer }), 'Resgate')
}

/** Impressão do pedido (SHA-256): o que a repetição compara. */
function requestHash(r: { prizeId: string; customerId: string; deliverNow: boolean }): string {
  return createHash('sha256').update(JSON.stringify([r.prizeId, r.customerId, r.deliverNow])).digest('hex')
}

type Keyed = { customerId: string; key: string; hash: string }

/**
 * Já existe resgate deste cliente com a chave? Pedido igual: devolve o original. Pedido diferente: `idempotency_key_reused`.
 * Chave com mais de 24 h: é liberada do resgate antigo (só com `release`) e o pedido segue como novo.
 */
async function replayOfKey(
  ctx: TenantContext,
  db: Db,
  r: Keyed,
  release: TenantTx | null,
): Promise<{ redemption: RedemptionView; balance: number; replayed: true } | null> {
  const found = await db.prizeRedemption.findFirst({ where: { customerId: r.customerId, idempotencyKey: r.key }, include: withCustomer })
  if (!found) return null
  if (minutesBetween(found.createdAt, ctx.clock()) > IDEMPOTENCY_TTL_MIN) {
    if (release) await release.prizeRedemption.update({ where: { id: found.id }, data: { idempotencyKey: null, idempotencyRequestHash: null } })
    return null
  }
  if (found.idempotencyRequestHash !== r.hash) {
    throw new DomainError('conflict', 'Esta chave de idempotência já foi usada em outro pedido. Gere uma chave nova para cada resgate diferente.', {
      reason: 'idempotency_key_reused',
    })
  }
  return { redemption: toView(ctx, found), balance: await getBalance(db, r.customerId), replayed: true }
}

function isIdempotencyViolation(err: unknown): boolean {
  return isUniqueViolation(err) && JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes(IDEMPOTENCY_INDEX)
}

/**
 * Resgata um prêmio. O cliente resgata o próprio; a equipe com `manage_loyalty` resgata por um cliente (`customerId`) e pode
 * entregar na hora. Tudo numa transação sob a trava do cliente: saldo (a soma do razão) cobre o custo, o estoque baixa por
 * UPDATE condicional, o resgate e o débito (`redemption:<id>`) nascem juntos. `Idempotency-Key` repetida devolve o original.
 */
export async function redeemPrize(
  ctx: TenantContext,
  i: { prizeId: string; customerId?: string; deliverNow?: boolean; expectedCostPoints?: number; idempotencyKey?: string },
): Promise<{ redemption: RedemptionView; balance: number; replayed: boolean }> {
  await requireModule(ctx, 'loyalty')
  const input = parse(redeemSchema, i)
  let customerId: string
  if (ctx.actor.kind === 'customer') {
    if (input.customerId !== undefined && input.customerId !== ctx.actor.customerId) {
      throw new DomainError('forbidden', 'Você só pode resgatar prêmios para você mesmo.')
    }
    if (input.deliverNow) throw new DomainError('forbidden', 'Só a equipe registra a entrega na hora.')
    customerId = ctx.actor.customerId
  } else {
    authorize(ctx, 'manage_loyalty')
    if (input.customerId === undefined) {
      const message = 'Escolha o cliente do resgate.'
      throw new DomainError('validation', message, { fields: { customerId: message } })
    }
    customerId = input.customerId
  }
  if (!idSchema.safeParse(input.prizeId).success) throw new DomainError('not_found', 'Prêmio não encontrado.')
  const prizeId = input.prizeId
  const deliverNow = input.deliverNow === true
  const by = party(ctx)
  const keyed: Keyed | null =
    input.idempotencyKey === undefined ? null : { customerId, key: input.idempotencyKey, hash: requestHash({ prizeId, customerId, deliverNow }) }

  try {
    return await ctx.db.$transaction(async (tx) => {
      await lockActiveCustomer(tx, customerId, 'Fale com o estabelecimento.')
      if (keyed) {
        const replay = await replayOfKey(ctx, tx, keyed, tx)
        if (replay) return replay
      }
      const prize = await tx.prize.findUnique({ where: { id: prizeId } })
      if (!prize || !prize.active || prize.archivedAt !== null) {
        throw new DomainError('not_found', 'Este prêmio não está disponível.')
      }
      // O custo que o cliente viu na vitrine precisa ser o de agora: se o dono mudou no meio, recusa em vez de debitar outro valor.
      if (input.expectedCostPoints !== undefined && input.expectedCostPoints !== prize.costPoints) {
        throw new DomainError('conflict', 'O custo deste prêmio mudou. Confira o novo custo e tente de novo.', {
          reason: 'changed',
          details: { costPoints: prize.costPoints },
        })
      }
      const balance = await getBalance(tx, customerId)
      if (balance < prize.costPoints) {
        throw new DomainError('conflict', `Faltam ${await pointsLabel(tx, ctx.businessId, prize.costPoints - balance)} para este prêmio.`, {
          reason: 'insufficient_points',
          details: { missing: prize.costPoints - balance },
        })
      }
      if (prize.stock !== null) {
        const { count } = await tx.prize.updateMany({ where: { id: prize.id, stock: { gte: 1 } }, data: { stock: { decrement: 1 } } })
        if (count === 0) throw new DomainError('conflict', 'Este prêmio acabou. Escolha outro prêmio.', { reason: 'out_of_stock' })
      }
      const now = ctx.clock()
      const created = await tx.prizeRedemption.create({
        data: {
          businessId: ctx.businessId,
          customerId,
          prizeId: prize.id,
          prizeName: prize.name,
          costPoints: prize.costPoints,
          stockTracked: prize.stock !== null,
          status: deliverNow ? 'DELIVERED' : 'PENDING',
          requestedByType: by.type as PartyType,
          requestedById: by.id,
          ...(deliverNow ? { deliveredAt: now } : {}),
          idempotencyKey: keyed?.key ?? null,
          idempotencyRequestHash: keyed?.hash ?? null,
          createdAt: now,
        },
        include: withCustomer,
      })
      await tx.loyaltyTransaction.create({
        data: {
          businessId: ctx.businessId,
          customerId,
          kind: 'REDEEM',
          points: -prize.costPoints,
          redemptionId: created.id,
          dedupeKey: `redemption:${created.id}`,
          createdByType: by.type,
          createdById: by.id,
        },
      })
      await audit(
        ctx,
        { action: 'prize.redeemed', targetType: 'PrizeRedemption', targetId: created.id, metadata: { customerId, prizeId: prize.id, costPoints: prize.costPoints, deliveredNow: deliverNow } },
        tx,
      )
      return { redemption: toView(ctx, created), balance: balance - prize.costPoints, replayed: false }
    }, TX_OPTIONS)
  } catch (err) {
    // Rede de segurança: a trava do cliente já impede a corrida; o índice único garante mesmo assim.
    if (keyed && isIdempotencyViolation(err)) {
      const replay = await replayOfKey(ctx, ctx.db, keyed, null)
      if (replay) return replay
    }
    throw err
  }
}

export async function listRedemptions(
  ctx: TenantContext,
  q: { status?: RedemptionStatus; customerId?: string; cursor?: string; limit?: number } = {},
): Promise<{ items: RedemptionView[]; nextCursor: string | null }> {
  await requireModule(ctx, 'loyalty')
  let own: string | null = null
  if (ctx.actor.kind === 'customer') own = ctx.actor.customerId
  else authorize(ctx, 'manage_loyalty')
  const { status, customerId, cursor, limit = DEFAULT_LIMIT } = parse(listSchema, q)
  const after = cursor === undefined ? null : decodeCursor(cursor)
  const where: Prisma.PrizeRedemptionWhereInput = {
    ...(own !== null ? { customerId: own } : customerId !== undefined ? { customerId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
  }
  const rows = await ctx.db.prizeRedemption.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: withCustomer, take: limit + 1 })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map((r) => toView(ctx, r)), nextCursor: rows.length > limit && last ? encodeCursor(last) : null }
}

/** Pendente vira entregue (equipe com `manage_loyalty`). A trava do cliente serializa com o cancelamento. */
export async function deliverRedemption(ctx: TenantContext, id: string): Promise<RedemptionView> {
  await requireModule(ctx, 'loyalty')
  authorize(ctx, 'manage_loyalty')
  const before = await loadRow(ctx.db, id)
  return ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', before.customerId)
    const row = await loadRow(tx, id)
    if (row.status !== 'PENDING') throw invalidTransition('Só dá para entregar resgates pendentes.')
    const { count } = await tx.prizeRedemption.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'DELIVERED', deliveredAt: ctx.clock() } })
    if (count !== 1) throw invalidTransition('Só dá para entregar resgates pendentes.')
    await audit(ctx, { action: 'prize.delivered', targetType: 'PrizeRedemption', targetId: id }, tx)
    return toView(ctx, await loadRow(tx, id))
  }, TX_OPTIONS)
}

/**
 * Cancela um resgate pendente: devolve os pontos (`redemption:<id>:reversal`) e o estoque. O cliente cancela o próprio; a
 * equipe com `manage_loyalty`, qualquer um. Sob a trava do cliente, duas chamadas juntas devolvem uma vez só.
 */
export async function cancelRedemption(ctx: TenantContext, id: string, i: { reason?: string | null } = {}): Promise<RedemptionView> {
  await requireModule(ctx, 'loyalty')
  const own = ctx.actor.kind === 'customer' ? ctx.actor.customerId : null
  if (own === null) authorize(ctx, 'manage_loyalty')
  const { reason } = parse(cancelSchema, i)
  const before = await loadRow(ctx.db, id)
  if (own !== null && before.customerId !== own) throw notFound()
  const by = party(ctx)
  return ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', before.customerId)
    const row = await loadRow(tx, id)
    if (row.status !== 'PENDING') throw invalidTransition('Só dá para cancelar resgates pendentes.')
    const { count } = await tx.prizeRedemption.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELED', canceledAt: ctx.clock(), cancelReason: reason ?? null },
    })
    if (count !== 1) throw invalidTransition('Só dá para cancelar resgates pendentes.')
    await tx.loyaltyTransaction.create({
      data: {
        businessId: ctx.businessId,
        customerId: row.customerId,
        kind: 'REDEEM_REVERSAL',
        points: row.costPoints,
        redemptionId: id,
        dedupeKey: `redemption:${id}:reversal`,
        createdByType: by.type,
        createdById: by.id,
      },
    })
    // Só devolve a unidade se o prêmio tinha estoque limitado quando foi resgatado (e ainda tem): senão ela nunca saiu.
    if (row.stockTracked) await tx.prize.updateMany({ where: { id: row.prizeId, stock: { not: null } }, data: { stock: { increment: 1 } } })
    await audit(ctx, { action: 'prize.redemption_canceled', targetType: 'PrizeRedemption', targetId: id, metadata: { customerId: row.customerId, costPoints: row.costPoints } }, tx)
    return toView(ctx, await loadRow(tx, id))
  }, TX_OPTIONS)
}
