import { createHash } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { DeliveryMethod, FulfillmentStatus, Order, OrderItem, OrderStatus, PartyType, Prisma } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { searchKey } from '@/server/domain/customers/contact'
import { authorize, DomainError, isUniqueViolation, orNotFound, parse, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { party } from '@/server/domain/scheduling/appointment-view'
import { IDEMPOTENCY_TTL_MIN } from '@/server/domain/scheduling/appointments'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { ownCustomerId } from '@/server/domain/store/addresses'
import type { AddressInput } from '@/server/domain/store/addresses'
import { lineKey, normalizeLines, priceCart } from '@/server/domain/store/cart'
import type { CartLine, PricedCart, RawCartLine } from '@/server/domain/store/cart'
import { orderVoided } from '@/server/domain/store/order-events'
import { quoteExpired, readQuote } from '@/server/domain/store/quote-token'
import { loadStoreSettings } from '@/server/domain/store/settings'
import type { StoreSettings } from '@/server/domain/store/settings'
import { PUBLIC_VOUCHER_FILTER } from '@/server/domain/vouchers/vouchers'
import { redeemedByItem } from '@/server/domain/vouchers/codes'
import { addMinutes, formatDateTime, minutesBetween } from '@/server/time'

export type { DeliveryMethod, FulfillmentStatus, OrderStatus }

export type OrderAttention = 'amount_mismatch' | 'stock_shortfall' | 'payment_reversed'
export type Delivery = { method: 'PICKUP' } | { method: 'SHIPPING'; addressId: string; quoteToken: string } | { method: 'NONE' }

export type OrderView = {
  id: string
  number: number
  status: OrderStatus
  fulfillmentStatus: FulfillmentStatus
  deliveryMethod: DeliveryMethod
  items: { kind: 'product' | 'voucher'; id: string; name: string; unitPriceCents: number; quantity: number; totalCents: number }[]
  itemsCents: number
  shippingCents: number
  totalCents: number
  shipping: { serviceName: string; days: number; trackingCode: string | null } | null
  address: Omit<AddressInput, 'label' | 'isDefault'> | null
  pickupInstructions: string | null
  customer: { id: string; name: string }
  customerNote: string | null
  createdLabel: string
  expiresAt: Date
  expiresLabel: string
  paidLabel: string | null
  canceledLabel: string | null
  cancelReason: string | null
  attention: OrderAttention | null
  canCancel: boolean
  canPay: boolean
}

type Row = Order & { items: OrderItem[]; customer: { id: string; name: string } }
type Db = TenantClient | TenantTx

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const FIRST_NUMBER = 1001
/** Pedidos aguardando pagamento (no prazo) que um cliente pode ter ao mesmo tempo: sem teto, um cliente seguraria o estoque da loja inteira. */
const MAX_OPEN_ORDERS = 3
/** Nome do índice único parcial `(business_id, customer_id, idempotency_key)`, criado na migração. */
const IDEMPOTENCY_INDEX = 'orders_idempotency_key_key'
const withRelations = { items: { orderBy: { position: 'asc' } }, customer: { select: { id: true, name: true } } } as const satisfies Prisma.OrderInclude
const idSchema = z.uuid()

const noteSchema = z
  .string('Escreva a observação em texto.')
  .trim()
  .max(300, 'Use até 300 caracteres na observação.')
  .transform((t) => (t === '' ? null : t))
  .nullable()

const deliverySchema = z.discriminatedUnion(
  'method',
  [
    z.strictObject({ method: z.literal('PICKUP') }),
    z.strictObject({
      method: z.literal('SHIPPING'),
      addressId: z.string('Escolha o endereço de entrega.').max(64),
      quoteToken: z.string('Calcule o frete antes de fazer o pedido.').min(1, 'Calcule o frete antes de fazer o pedido.').max(2000),
    }),
    z.strictObject({ method: z.literal('NONE') }),
  ],
  'Escolha retirada no local ou entrega.',
)

const createSchema = z.object({
  delivery: deliverySchema,
  note: noteSchema,
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

const FULFILLMENT = ['PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'] as const
const advanceSchema = z.object({
  to: z.enum(FULFILLMENT, 'Escolha uma etapa da entrega válida.'),
  trackingCode: z
    .string('Escreva o código de rastreio em texto.')
    .trim()
    .max(40, 'Use até 40 caracteres no código de rastreio.')
    .transform((t) => (t === '' ? null : t))
    .nullable()
    .optional(),
})

const listSchema = z.object({
  status: z.enum(['AWAITING_PAYMENT', 'PAID', 'CANCELED', 'EXPIRED', 'to_fulfill', 'delivered', 'closed'], 'Escolha uma situação válida.').optional(),
  search: z.string().max(100, 'Use até 100 caracteres na busca.').optional(),
  customerId: z.uuid('Escolha um cliente válido.').optional(),
  cursor: z.string().max(1024).optional(),
  limit: z
    .number()
    .int('Informe o limite como número inteiro.')
    .min(1, 'O limite mínimo é 1.')
    .max(MAX_LIMIT, `O limite máximo é ${MAX_LIMIT}.`)
    .optional(),
})

/** Etapas que cada forma de entrega permite a partir de cada etapa: um passo adiante ou um passo para trás (engano). */
const TRANSITIONS: Record<DeliveryMethod, Partial<Record<FulfillmentStatus, readonly FulfillmentStatus[]>>> = {
  PICKUP: { PENDING: ['READY_FOR_PICKUP'], READY_FOR_PICKUP: ['DELIVERED', 'PENDING'], DELIVERED: ['READY_FOR_PICKUP'] },
  SHIPPING: { PENDING: ['SHIPPED'], SHIPPED: ['DELIVERED', 'PENDING'], DELIVERED: ['SHIPPED'] },
  NONE: { PENDING: ['DELIVERED'], DELIVERED: ['PENDING'] },
}

const notFound = (): DomainError => new DomainError('not_found', 'Pedido não encontrado.')
const fieldError = (field: string, message: string): DomainError => new DomainError('validation', message, { fields: { [field]: message } })
const invalidTransition = (message: string): DomainError => new DomainError('conflict', message, { reason: 'invalid_transition' })

function toView(ctx: TenantContext, row: Row, settings: StoreSettings): OrderView {
  const label = (d: Date | null) => (d === null ? null : formatDateTime(d, ctx.timeZone))
  const isCustomer = ctx.actor.kind === 'customer'
  const open = row.status === 'AWAITING_PAYMENT'
  const hasAddress = row.shipRecipient !== null && row.shipPostalCode !== null && row.shipStreet !== null && row.shipNumber !== null && row.shipDistrict !== null && row.shipCity !== null && row.shipState !== null
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    fulfillmentStatus: row.fulfillmentStatus,
    deliveryMethod: row.deliveryMethod,
    items: row.items.map((i) => ({ kind: i.voucherId === null ? 'product' : 'voucher', id: i.productId ?? i.voucherId ?? i.id, name: i.name, unitPriceCents: i.unitPriceCents, quantity: i.quantity, totalCents: i.totalCents })),
    itemsCents: row.itemsCents,
    shippingCents: row.shippingCents,
    totalCents: row.totalCents,
    shipping: row.deliveryMethod === 'SHIPPING' && row.shippingServiceName !== null ? { serviceName: row.shippingServiceName, days: row.shippingDays ?? 0, trackingCode: row.trackingCode } : null,
    address: hasAddress
      ? {
          recipientName: row.shipRecipient ?? '',
          postalCode: row.shipPostalCode ?? '',
          street: row.shipStreet ?? '',
          number: row.shipNumber ?? '',
          complement: row.shipComplement,
          district: row.shipDistrict ?? '',
          city: row.shipCity ?? '',
          state: row.shipState ?? '',
        }
      : null,
    pickupInstructions: row.deliveryMethod === 'PICKUP' ? settings.pickupInstructions : null,
    customer: { id: row.customer.id, name: row.customer.name },
    customerNote: row.customerNote,
    createdLabel: formatDateTime(row.createdAt, ctx.timeZone),
    expiresAt: row.expiresAt,
    expiresLabel: formatDateTime(row.expiresAt, ctx.timeZone),
    paidLabel: label(row.paidAt),
    canceledLabel: label(row.canceledAt),
    cancelReason: row.cancelReason,
    attention: row.attention === 'amount_mismatch' || row.attention === 'stock_shortfall' || row.attention === 'payment_reversed' ? row.attention : null,
    // O cliente cancela enquanto aguarda o pagamento; a equipe também o pedido já pago (o estorno é feito no Mercado Pago).
    canCancel: isCustomer ? open : can(ctx.actor, 'manage_store') && (open || row.status === 'PAID'),
    canPay: isCustomer && open && ctx.clock().getTime() < row.expiresAt.getTime(),
  }
}

async function loadRow(db: Db, id: string): Promise<Row> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await db.order.findUnique({ where: { id }, include: withRelations }), 'Pedido')
}

/** Quem pode ler: o cliente, só os próprios pedidos; a equipe com `manage_store`, todos. Devolve o id do cliente quando é cliente. */
async function readerScope(ctx: TenantContext): Promise<string | null> {
  await requireModule(ctx, 'store')
  if (ctx.actor.kind === 'customer') return ctx.actor.customerId
  authorize(ctx, 'manage_store')
  return null
}

export async function getOrder(ctx: TenantContext, id: string): Promise<OrderView> {
  const own = await readerScope(ctx)
  const row = await loadRow(ctx.db, id)
  if (own !== null && row.customerId !== own) throw notFound()
  return toView(ctx, row, await loadStoreSettings(ctx))
}

function encodeCursor(number: number): string {
  return Buffer.from(JSON.stringify([number])).toString('base64url')
}

function decodeCursor(cursor: string): number {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && parsed.length === 1 && Number.isSafeInteger(parsed[0]) && (parsed[0] as number) >= 1) return parsed[0] as number
  } catch {
    // cai no erro abaixo
  }
  throw new DomainError('validation', 'O cursor de paginação é inválido. Recarregue a lista.', { fields: { cursor: 'Cursor inválido.' } })
}

/**
 * Pedidos do mais novo ao mais antigo, por cursor. O cliente vê só os dele; a equipe com `manage_store` vê todos e filtra por
 * situação (`to_fulfill` = pagos que ainda não foram entregues; `delivered` = pagos e entregues; `closed` = cancelados e vencidos), busca (número ou nome do cliente) e cliente.
 */
export async function listOrders(
  ctx: TenantContext,
  q: { status?: OrderStatus | 'to_fulfill' | 'delivered' | 'closed'; search?: string; customerId?: string; cursor?: string; limit?: number } = {},
): Promise<{ items: OrderView[]; nextCursor: string | null }> {
  const own = await readerScope(ctx)
  const f = parse(listSchema, q)
  const limit = f.limit ?? DEFAULT_LIMIT
  const after = f.cursor === undefined ? null : decodeCursor(f.cursor)
  // O byte zero e os outros caracteres de controle nunca chegam ao banco.
  const search = (f.search ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const where: Prisma.OrderWhereInput = {
    AND: [
      own !== null ? { customerId: own } : f.customerId !== undefined ? { customerId: f.customerId } : {},
      f.status === 'to_fulfill'
        ? { status: 'PAID', fulfillmentStatus: { not: 'DELIVERED' } }
        : f.status === 'delivered'
          ? { status: 'PAID', fulfillmentStatus: 'DELIVERED' }
          : f.status === 'closed'
            ? { status: { in: ['CANCELED', 'EXPIRED'] } }
            : f.status !== undefined
              ? { status: f.status }
              : {},
      search === '' || own !== null ? {} : /^\d{1,9}$/.test(search) ? { number: Number(search) } : { customer: { searchName: { contains: searchKey(search) } } },
      after !== null ? { number: { lt: after } } : {},
    ],
  }
  const rows = await ctx.db.order.findMany({ where, orderBy: { number: 'desc' }, include: withRelations, take: limit + 1 })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const settings = await loadStoreSettings(ctx)
  return { items: page.map((r) => toView(ctx, r, settings)), nextCursor: rows.length > limit && last ? encodeCursor(last.number) : null }
}

/** Impressão do pedido (SHA-256 de uma forma canônica): é o que a repetição da mesma `Idempotency-Key` compara. */
function requestHash(r: { lines: CartLine[]; delivery: Delivery; note: string | null }): string {
  const lines = [...r.lines].sort((a, b) => (lineKey(a) < lineKey(b) ? -1 : lineKey(a) > lineKey(b) ? 1 : 0)).map((l) => [lineKey(l), l.quantity])
  const d = r.delivery
  const delivery = d.method === 'SHIPPING' ? [d.method, d.addressId.toLowerCase(), d.quoteToken] : [d.method]
  return createHash('sha256').update(JSON.stringify([lines, delivery, r.note])).digest('hex')
}

type Keyed = { customerId: string; key: string; hash: string }

/**
 * Já existe pedido deste cliente com a chave? Pedido igual: devolve o original como está hoje. Pedido diferente:
 * `idempotency_key_reused`. Chave com mais de 24 h: é liberada do pedido antigo (só com `release`) e o pedido segue como novo.
 */
async function replayOfKey(ctx: TenantContext, db: Db, r: Keyed, release: TenantTx | null): Promise<OrderView | null> {
  const found = await db.order.findFirst({ where: { customerId: r.customerId, idempotencyKey: r.key }, include: withRelations })
  if (found === null) return null
  if (minutesBetween(found.createdAt, ctx.clock()) > IDEMPOTENCY_TTL_MIN) {
    if (release) await release.order.update({ where: { id: found.id }, data: { idempotencyKey: null, idempotencyRequestHash: null } })
    return null
  }
  if (found.idempotencyRequestHash !== r.hash) {
    throw new DomainError('conflict', 'Esta chave de idempotência já foi usada em outro pedido. Gere uma chave nova para cada pedido diferente.', { reason: 'idempotency_key_reused' })
  }
  return toView(ctx, found, await loadStoreSettings(ctx, db))
}

function isIdempotencyViolation(err: unknown): boolean {
  return isUniqueViolation(err) && JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes(IDEMPOTENCY_INDEX)
}

type Resolved = {
  method: DeliveryMethod
  shippingCents: number
  fields: Pick<Prisma.OrderUncheckedCreateInput, 'shippingServiceCode' | 'shippingServiceName' | 'shippingDays' | 'shipRecipient' | 'shipPostalCode' | 'shipStreet' | 'shipNumber' | 'shipComplement' | 'shipDistrict' | 'shipCity' | 'shipState'>
}

const invalidQuote = (): DomainError => {
  const message = 'A cotação do frete não vale para este pedido. Calcule o frete de novo e escolha a entrega outra vez.'
  return new DomainError('validation', message, { reason: 'invalid_quote', fields: { 'delivery.quoteToken': message } })
}

/**
 * Decide frete e endereço do pedido. O frete NUNCA vem do app: na entrega é o preço que está DENTRO da cotação assinada, e a
 * cotação só vale para esta conta, este cliente, este endereço (com o mesmo CEP de quando foi cotada) e este carrinho.
 */
async function resolveDelivery(ctx: TenantContext, tx: TenantTx, customerId: string, delivery: Delivery, settings: StoreSettings, cart: PricedCart): Promise<Resolved> {
  // Carrinho só de vouchers não tem o que retirar nem entregar: a única forma é `NONE`. Carrinho com produto segue as regras de sempre.
  if (!cart.physical && delivery.method !== 'NONE') throw fieldError('delivery', 'Este pedido só tem vouchers: não tem retirada nem entrega. Escolha "sem entrega".')
  if (delivery.method === 'PICKUP') {
    if (!settings.pickupEnabled) throw new DomainError('conflict', 'A retirada no local não está disponível. Escolha a entrega.', { reason: 'pickup_unavailable' })
    return { method: 'PICKUP', shippingCents: 0, fields: {} }
  }
  if (delivery.method === 'NONE') {
    // Só carrinho sem item físico dispensa entrega (todo produto é físico; voucher não).
    if (cart.physical) throw fieldError('delivery', 'Escolha retirada no local ou entrega.')
    return { method: 'NONE', shippingCents: 0, fields: {} }
  }
  if (!settings.shippingEnabled) throw new DomainError('conflict', 'A entrega não está disponível. Escolha a retirada no local.', { reason: 'shipping_unavailable' })
  const address = idSchema.safeParse(delivery.addressId).success ? await tx.address.findFirst({ where: { id: delivery.addressId, customerId } }) : null
  if (address === null) throw new DomainError('not_found', 'Endereço não encontrado.')
  const quote = readQuote(delivery.quoteToken)
  if (
    quote === null ||
    quote.businessId !== ctx.businessId ||
    quote.customerId !== customerId ||
    quote.addressId !== address.id ||
    quote.postalCode !== address.postalCode ||
    quote.cartHash !== cart.hash
  ) {
    throw invalidQuote()
  }
  if (quoteExpired(quote, ctx.clock())) throw new DomainError('conflict', 'A cotação do frete venceu. Calcule o frete de novo.', { reason: 'quote_expired' })
  return {
    method: 'SHIPPING',
    shippingCents: quote.priceCents,
    fields: {
      shippingServiceCode: quote.serviceCode,
      shippingServiceName: quote.serviceName,
      shippingDays: quote.days,
      shipRecipient: address.recipientName,
      shipPostalCode: address.postalCode,
      shipStreet: address.street,
      shipNumber: address.number,
      shipComplement: address.complement,
      shipDistrict: address.district,
      shipCity: address.city,
      shipState: address.state,
    },
  }
}

function outOfStock(name: string, stock: number): DomainError {
  const message = stock <= 0 ? `Acabou o estoque de ${name}. Tire-o do carrinho.` : `Só ${stock === 1 ? 'resta 1 unidade' : `restam ${stock} unidades`} de ${name}. Diminua a quantidade.`
  return new DomainError('conflict', message, { reason: 'out_of_stock' })
}

/**
 * Cria o pedido do cliente. Reprecifica o carrinho no banco, decide o frete pela cotação assinada e, numa transação sob a
 * trava da loja, numera o pedido (a partir de 1001), RESERVA o estoque linha a linha por UPDATE condicional (`stock >= qtd`:
 * falhou uma, nada é gravado) e grava o pedido com nome e preço de cada item copiados. `Idempotency-Key` repetida devolve o
 * original sem reservar de novo.
 */
export async function createOrder(
  ctx: TenantContext,
  i: { lines: RawCartLine[]; delivery: Delivery; note: string | null; idempotencyKey?: string },
): Promise<{ order: OrderView; replayed: boolean }> {
  const customerId = await ownCustomerId(ctx)
  const input = parse(createSchema, { delivery: i.delivery, note: i.note, idempotencyKey: i.idempotencyKey })
  const lines = normalizeLines(i.lines)
  const delivery = input.delivery
  const keyed: Keyed | null =
    input.idempotencyKey === undefined ? null : { customerId, key: input.idempotencyKey, hash: requestHash({ lines, delivery, note: input.note }) }
  // Repetição de um pedido já atendido: responde antes de repreçar (preço e estoque podem ter mudado desde então).
  if (keyed) {
    const replay = await replayOfKey(ctx, ctx.db, keyed, null)
    if (replay) return { order: replay, replayed: true }
  }
  try {
    return await ctx.db.$transaction(async (tx) => {
      // A trava da loja serializa os pedidos da conta: o número sai sem repetição e a repetição da chave vê o pedido já gravado.
      await tx.$lockKey('store', ctx.businessId)
      if (keyed) {
        const replay = await replayOfKey(ctx, tx, keyed, tx)
        if (replay) return { order: replay, replayed: true }
      }
      // Contado sob a trava da loja: dois pedidos ao mesmo tempo não passam juntos do teto. O vencido ainda não varrido não conta.
      const open = await tx.order.count({ where: { customerId, status: 'AWAITING_PAYMENT', expiresAt: { gt: ctx.clock() } } })
      if (open >= MAX_OPEN_ORDERS) throw new DomainError('conflict', 'Você já tem pedidos esperando pagamento. Pague ou cancele um deles.', { reason: 'too_many_open_orders' })
      const settings = await loadStoreSettings(ctx, tx)
      const cart = await priceCart(ctx, lines, tx)
      const resolved = await resolveDelivery(ctx, tx, customerId, delivery, settings, cart)
      // Reserva em ordem de id: dois pedidos com os mesmos produtos nunca esperam um ao outro em ordens trocadas.
      // Primeiro os produtos, depois os vouchers (cada grupo em ordem de id): a ordem é a mesma em todo pedido.
      const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      for (const l of cart.lines.filter((x) => x.kind === 'product').sort(byId)) {
        const { count } = await tx.product.updateMany({ where: { id: l.id, active: true, archivedAt: null, stock: { gte: l.quantity } }, data: { stock: { decrement: l.quantity } } })
        if (count === 0) {
          const atual = await tx.product.findUnique({ where: { id: l.id }, select: { stock: true } })
          throw outOfStock(l.name, atual?.stock ?? 0)
        }
      }
      for (const l of cart.lines.filter((x) => x.kind === 'voucher').sort(byId)) {
        const { count } = await tx.voucher.updateMany({ where: { id: l.id, ...PUBLIC_VOUCHER_FILTER, stock: { gte: l.quantity } }, data: { stock: { decrement: l.quantity } } })
        if (count === 0) {
          const atual = await tx.voucher.findUnique({ where: { id: l.id }, select: { stock: true } })
          throw outOfStock(l.name, atual?.stock ?? 0)
        }
      }
      const now = ctx.clock()
      const last = await tx.order.aggregate({ _max: { number: true } })
      const number = Math.max(last._max.number ?? 0, FIRST_NUMBER - 1) + 1
      const order = await tx.order.create({
        data: {
          businessId: ctx.businessId,
          number,
          customerId,
          deliveryMethod: resolved.method,
          itemsCents: cart.itemsCents,
          shippingCents: resolved.shippingCents,
          totalCents: cart.itemsCents + resolved.shippingCents,
          ...resolved.fields,
          customerNote: input.note,
          expiresAt: addMinutes(now, settings.paymentWindowMin),
          idempotencyKey: keyed?.key ?? null,
          idempotencyRequestHash: keyed?.hash ?? null,
          createdAt: now,
        },
      })
      await tx.orderItem.createMany({
        data: cart.lines.map((l, index) => ({ businessId: ctx.businessId, orderId: order.id, ...(l.kind === 'product' ? { productId: l.id } : { voucherId: l.id }), name: l.name, unitPriceCents: l.unitPriceCents, quantity: l.quantity, totalCents: l.totalCents, position: index + 1 })),
      })
      await audit(ctx, { action: 'order.created', targetType: 'Order', targetId: order.id, metadata: { number, totalCents: order.totalCents, delivery: resolved.method } }, tx)
      return { order: toView(ctx, await loadRow(tx, order.id), settings), replayed: false }
    }, TX_OPTIONS)
  } catch (err) {
    // Rede de segurança: a trava já impede a corrida; o índice único garante mesmo assim.
    if (keyed && isIdempotencyViolation(err)) {
      const replay = await replayOfKey(ctx, ctx.db, keyed, null)
      if (replay) return { order: replay, replayed: true }
    }
    throw err
  }
}

/**
 * Cancela um pedido. O cliente cancela o próprio, só aguardando pagamento; a equipe com `manage_store` também o já pago (o
 * estorno do dinheiro é feito no Mercado Pago). Sob a trava do pedido; o estoque volta uma vez só (`orderVoided`).
 */
export async function cancelOrder(ctx: TenantContext, id: string, i: { reason?: string | null } = {}): Promise<OrderView> {
  await requireModule(ctx, 'store')
  const own = ctx.actor.kind === 'customer' ? ctx.actor.customerId : null
  if (own === null) authorize(ctx, 'manage_store')
  const { reason } = parse(cancelSchema, i)
  const before = await loadRow(ctx.db, id)
  if (own !== null && before.customerId !== own) throw notFound()
  const by = party(ctx)
  const allowed: OrderStatus[] = own !== null ? ['AWAITING_PAYMENT'] : ['AWAITING_PAYMENT', 'PAID']
  const settings = await loadStoreSettings(ctx)
  const row = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('order', id)
    const current = await loadRow(tx, id)
    const message = own !== null ? 'Só dá para cancelar pedidos que aguardam o pagamento.' : 'Só dá para cancelar pedidos que aguardam o pagamento ou já foram pagos.'
    if (!allowed.includes(current.status)) throw invalidTransition(message)
    // Voucher já usado no balcão não volta: a equipe resolve com o cliente e estorna no Mercado Pago (o estorno automático avisa o pedido).
    if (current.status === 'PAID' && (await redeemedByItem(tx, id)).size > 0) {
      throw new DomainError('conflict', 'Este pedido tem voucher já usado no balcão. Não dá para cancelá-lo: estorne o pagamento no Mercado Pago e confira o que foi usado.', { reason: 'codes_in_use' })
    }
    const { count } = await tx.order.updateMany({
      where: { id, status: current.status },
      data: { status: 'CANCELED', canceledAt: ctx.clock(), canceledByType: by.type as PartyType, canceledById: by.id, cancelReason: reason ?? null },
    })
    if (count !== 1) throw invalidTransition(message)
    await orderVoided(tx, ctx, id, 'canceled')
    await audit(ctx, { action: 'order.canceled', targetType: 'Order', targetId: id, metadata: { was: current.status } }, tx)
    return loadRow(tx, id)
  }, TX_OPTIONS)
  return toView(ctx, row, settings)
}

/**
 * Muda a etapa da entrega de um pedido PAGO (equipe com `manage_store`): retirada vai de pendente a pronta e a entregue; entrega
 * vai de pendente a enviada (com código de rastreio opcional) e a entregue. Voltar um passo vale (engano); o resto é
 * `invalid_transition`.
 */
export async function advanceFulfillment(ctx: TenantContext, id: string, i: { to: FulfillmentStatus; trackingCode?: string | null }): Promise<OrderView> {
  await requireModule(ctx, 'store')
  authorize(ctx, 'manage_store')
  const input = parse(advanceSchema, i)
  if (input.trackingCode !== undefined && input.trackingCode !== null && input.to !== 'SHIPPED') {
    throw fieldError('trackingCode', 'O código de rastreio só vale ao marcar o pedido como enviado.')
  }
  await loadRow(ctx.db, id)
  const settings = await loadStoreSettings(ctx)
  const row = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('order', id)
    const current = await loadRow(tx, id)
    const allowed = TRANSITIONS[current.deliveryMethod][current.fulfillmentStatus] ?? []
    if (current.status !== 'PAID') throw invalidTransition('Só pedidos pagos mudam de etapa de entrega.')
    if (!allowed.includes(input.to)) throw invalidTransition('Esta etapa não vem depois da etapa atual do pedido. Siga a ordem da entrega.')
    const { count } = await tx.order.updateMany({
      where: { id, status: 'PAID', fulfillmentStatus: current.fulfillmentStatus },
      data: { fulfillmentStatus: input.to, ...(input.to === 'SHIPPED' && input.trackingCode ? { trackingCode: input.trackingCode } : {}) },
    })
    if (count !== 1) throw invalidTransition('O pedido mudou agora. Recarregue para ver.')
    await audit(ctx, { action: 'order.fulfillment_changed', targetType: 'Order', targetId: id, metadata: { from: current.fulfillmentStatus, to: input.to } }, tx)
    return loadRow(tx, id)
  }, TX_OPTIONS)
  return toView(ctx, row, settings)
}
