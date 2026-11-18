import { randomInt } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import type { Prisma, VoucherCode } from '@/server/db/generated/client'
import type { TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { searchKey } from '@/server/domain/customers/contact'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { party } from '@/server/domain/scheduling/appointment-view'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { addDays, formatDate, formatDateTime, fromEpochMs, localDayRange, localParts } from '@/server/time'

export type VoucherCodeStatus = 'ACTIVE' | 'REDEEMED' | 'VOID' | 'EXPIRED'

export type VoucherCodeView = {
  id: string
  code: string
  status: VoucherCodeStatus
  voucher: { id: string; name: string }
  partnerName: string
  partner: { name: string; address: string | null; phone: string | null; website: string | null }
  customer: { id: string; name: string }
  orderId: string
  orderNumber: number
  expiresAt: Date | null
  expiresLabel: string | null
  redeemedLabel: string | null
  voidReason: string | null
}

/**
 * Alfabeto dos códigos: 31 símbolos, sem 0, 1, I, L e O (que se confundem na leitura e na digitação). Oito símbolos dão
 * 31^8, quase 8,5 x 10^11 códigos por conta; a baixa só existe para a equipe logada, então o código não precisa de mais.
 */
export const VOUCHER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 8
const MAX_ATTEMPTS = 5
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/** Um código novo, `XXXX-XXXX`, sorteado com `crypto.randomInt` (sem viés de módulo). */
export function generateVoucherCode(): string {
  let text = ''
  for (let i = 0; i < CODE_LENGTH; i++) text += VOUCHER_CODE_ALPHABET.charAt(randomInt(0, VOUCHER_CODE_ALPHABET.length))
  return `${text.slice(0, 4)}-${text.slice(4)}`
}

/** O código como o balcão o digita (minúsculas, espaços, sem hífen) vira `XXXX-XXXX`; qualquer coisa fora do alfabeto vira `null`. */
export function normalizeVoucherCode(input: string): string | null {
  if (typeof input !== 'string' || !/^[A-Za-z0-9\s-]*$/.test(input)) return null
  const text = input.replace(/[\s-]/g, '').toUpperCase()
  if (text.length !== CODE_LENGTH) return null
  for (const ch of text) if (!VOUCHER_CODE_ALPHABET.includes(ch)) return null
  return `${text.slice(0, 4)}-${text.slice(4)}`
}

const idSchema = z.uuid()
const withRelations = {
  voucher: { select: { id: true, name: true, partner: { select: { name: true, address: true, phone: true, website: true } } } },
  customer: { select: { id: true, name: true } },
  order: { select: { number: true } },
} as const satisfies Prisma.VoucherCodeInclude
type Row = Prisma.VoucherCodeGetPayload<{ include: typeof withRelations }>

function statusOf(row: Pick<VoucherCode, 'status' | 'expiresAt'>, now: Date): VoucherCodeStatus {
  if (row.status === 'ACTIVE' && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return row.status
}

function redeemedText(ctx: TenantContext, row: Pick<VoucherCode, 'redeemedAt' | 'redeemedByName'>): string | null {
  if (row.redeemedAt === null) return null
  const when = formatDateTime(row.redeemedAt, ctx.timeZone)
  return row.redeemedByName ? `${when} por ${row.redeemedByName}` : when
}

function toView(ctx: TenantContext, row: Row): VoucherCodeView {
  return {
    id: row.id,
    code: row.code,
    status: statusOf(row, ctx.clock()),
    voucher: { id: row.voucher.id, name: row.voucher.name },
    partnerName: row.voucher.partner.name,
    partner: { ...row.voucher.partner },
    customer: { id: row.customer.id, name: row.customer.name },
    orderId: row.orderId,
    orderNumber: row.order.number,
    expiresAt: row.expiresAt,
    expiresLabel: row.expiresAt === null ? null : formatDate(row.expiresAt, ctx.timeZone),
    redeemedLabel: redeemedText(ctx, row),
    voidReason: row.voidReason,
  }
}

/** Fim do dia local (23:59:59.999) do dia `days` depois do dia local de `from`, no fuso da conta. */
function endOfLocalDay(from: Date, days: number, tz: string): Date {
  const target = addDays(localParts(from, tz).date, days)
  return fromEpochMs(localDayRange(target, tz).end.getTime() - 1)
}

/**
 * Gera os códigos de um pedido PAGO: `quantity` por linha de voucher, `seq` 1..quantidade. Repetir é inofensivo e vale até
 * sem a trava do pedido: `(order_item_id, seq)` é único e a gravação ignora duplicados (`skipDuplicates`), então só o que falta
 * é criado. Código repetido na conta (único `(business_id, code)`) também é ignorado e a unidade que ficou sem código ganha
 * outro sorteio, até 5 tentativas; depois disso falha (e a transação do pagamento volta atrás). Códigos anulados por um
 * estorno voltam a valer quando outro pagamento reabre o pedido. Devolve quantos códigos criou. Chame dentro da transação.
 */
export async function issueCodesForOrder(tx: TenantTx, ctx: TenantContext, orderId: string, generate: () => string = generateVoucherCode): Promise<number> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { where: { voucherId: { not: null } }, orderBy: { position: 'asc' } } } })
  if (order === null || order.items.length === 0) return 0
  await tx.voucherCode.updateMany({ where: { orderId, status: 'VOID' }, data: { status: 'ACTIVE', voidedAt: null, voidReason: null } })
  const vouchers = await tx.voucher.findMany({ where: { id: { in: order.items.flatMap((i) => (i.voucherId === null ? [] : [i.voucherId])) } }, select: { id: true, validDays: true } })
  const validDays = new Map(vouchers.map((v) => [v.id, v.validDays]))
  const paidAt = order.paidAt ?? ctx.clock()
  const now = ctx.clock()

  const missing = async () => {
    const have = new Set((await tx.voucherCode.findMany({ where: { orderItemId: { in: order.items.map((i) => i.id) } }, select: { orderItemId: true, seq: true } })).map((c) => `${c.orderItemId}:${c.seq}`))
    const rows: Prisma.VoucherCodeCreateManyInput[] = []
    for (const item of order.items) {
      if (item.voucherId === null) continue
      const days = validDays.get(item.voucherId) ?? null
      const expiresAt = days === null ? null : endOfLocalDay(paidAt, days, ctx.timeZone)
      for (let seq = 1; seq <= item.quantity; seq++) {
        if (!have.has(`${item.id}:${seq}`)) rows.push({ businessId: ctx.businessId, voucherId: item.voucherId, orderId, orderItemId: item.id, customerId: order.customerId, seq, code: generate(), expiresAt, createdAt: now })
      }
    }
    return rows
  }

  let created = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await missing()
    if (rows.length === 0) return created
    created += (await tx.voucherCode.createMany({ data: rows, skipDuplicates: true })).count
  }
  if ((await missing()).length === 0) return created
  throw new Error('voucher_code_generation_failed')
}

/** Anula os códigos ATIVOS do pedido (o usado fica). Devolve quantos anulou. Chame dentro da transação, sob a trava do pedido. */
export async function voidCodesForOrder(tx: TenantTx, ctx: TenantContext, orderId: string, reason: string): Promise<number> {
  const { count } = await tx.voucherCode.updateMany({ where: { orderId, status: 'ACTIVE' }, data: { status: 'VOID', voidedAt: ctx.clock(), voidReason: reason } })
  if (count > 0) await audit(ctx, { action: 'voucher_codes.voided', targetType: 'Order', targetId: orderId, metadata: { count, reason } }, tx)
  return count
}

/** Códigos já usados de um pedido, por item (`orderItemId` → quantos). */
export async function redeemedByItem(tx: TenantTx, orderId: string): Promise<Map<string, number>> {
  const rows = await tx.voucherCode.findMany({ where: { orderId, status: 'REDEEMED' }, select: { orderItemId: true } })
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.orderItemId, (map.get(r.orderItemId) ?? 0) + 1)
  return map
}

async function guard(ctx: TenantContext): Promise<void> {
  await requireModule(ctx, 'vouchers')
  authorize(ctx, 'manage_vouchers')
}

function normalizedOrFail(code: string): string {
  const normalized = normalizeVoucherCode(code)
  if (normalized === null) {
    const message = 'Digite o código com 8 letras e números, como K7QM-4XHT. Ele não tem 0, 1, I, L nem O.'
    throw new DomainError('validation', message, { fields: { code: message } })
  }
  return normalized
}

async function findRow(db: TenantContext['db'] | TenantTx, code: string): Promise<Row> {
  return orNotFound(await db.voucherCode.findFirst({ where: { code: normalizedOrFail(code) }, include: withRelations }), 'Código')
}

/** Consulta um código no balcão (situação, voucher, parceiro e cliente), sem dar baixa. Só da conta de quem consulta. */
export async function findVoucherCode(ctx: TenantContext, code: string): Promise<VoucherCodeView> {
  await guard(ctx)
  return toView(ctx, await findRow(ctx.db, code))
}

function refusal(ctx: TenantContext, row: Row, now: Date): DomainError {
  if (row.status === 'REDEEMED') {
    return new DomainError('conflict', `Este código já foi usado em ${redeemedText(ctx, row) ?? 'outra data'}.`, { reason: 'already_redeemed' })
  }
  if (row.status === 'VOID') {
    return new DomainError('conflict', `Este código foi anulado${row.voidReason ? ` (${row.voidReason.replace(/\.$/, '')})` : ''}. Não dá para dar baixa.`, { reason: 'code_void' })
  }
  if (statusOf(row, now) === 'EXPIRED' && row.expiresAt !== null) {
    return new DomainError('conflict', `Este código venceu em ${formatDate(row.expiresAt, ctx.timeZone)}. Não dá para dar baixa.`, { reason: 'code_expired' })
  }
  return new DomainError('not_found', 'Código não encontrado.')
}

function actorName(ctx: TenantContext): string | null {
  const a = ctx.actor
  return a.kind === 'member' || a.kind === 'impersonator' || a.kind === 'platform_admin' ? a.name : null
}

/**
 * Dá baixa num código, uma vez só. Sob a trava do pedido (que também serializa estorno e cancelamento), um UPDATE condicional
 * (`status = ACTIVE` e sem vencer) decide: quem chega com 0 linhas relê o código e recebe o motivo (`already_redeemed` com
 * quando e por quem, `code_void` ou `code_expired`). Código inexistente ou de outra conta é `not_found`. A auditoria não
 * leva o código.
 */
export async function redeemVoucherCode(ctx: TenantContext, code: string): Promise<VoucherCodeView> {
  await guard(ctx)
  const found = await findRow(ctx.db, code)
  const by = party(ctx)
  return ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('order', found.orderId)
    const now = ctx.clock()
    const { count } = await tx.voucherCode.updateMany({
      where: { id: found.id, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { status: 'REDEEMED', redeemedAt: now, redeemedByType: by.type, redeemedById: by.id, redeemedByName: actorName(ctx) },
    })
    const current = orNotFound(await tx.voucherCode.findUnique({ where: { id: found.id }, include: withRelations }), 'Código')
    if (count === 0) throw refusal(ctx, current, now)
    await audit(ctx, { action: 'voucher_code.redeemed', targetType: 'VoucherCode', targetId: found.id, metadata: { voucherId: current.voucherId, orderNumber: current.order.number } }, tx)
    return toView(ctx, current)
  }, TX_OPTIONS)
}

const listSchema = z.object({
  status: z.enum(['ACTIVE', 'REDEEMED', 'VOID', 'EXPIRED'], 'Escolha uma situação válida.').optional(),
  voucherId: z.uuid('Escolha um voucher válido.').optional(),
  search: z.string().max(100, 'Use até 100 caracteres na busca.').optional(),
  cursor: z.string().max(1024).optional(),
  limit: z.number().int('Informe o limite como número inteiro.').min(1, 'O limite mínimo é 1.').max(MAX_LIMIT, `O limite máximo é ${MAX_LIMIT}.`).optional(),
})

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.getTime(), row.id])).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isSafeInteger(parsed[0]) && typeof parsed[1] === 'string' && idSchema.safeParse(parsed[1]).success) {
      return { createdAt: fromEpochMs(parsed[0] as number), id: parsed[1] }
    }
  } catch {
    // cai no erro abaixo
  }
  throw new DomainError('validation', 'O cursor de paginação é inválido. Recarregue a lista.', { fields: { cursor: 'Cursor inválido.' } })
}

function searchFilter(raw: string): Prisma.VoucherCodeWhereInput {
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (text === '') return {}
  const or: Prisma.VoucherCodeWhereInput[] = [{ customer: { searchName: { contains: searchKey(text) } } }]
  if (/^\d{1,9}$/.test(text)) or.push({ order: { number: Number(text) } })
  const letters = text.toUpperCase().replace(/[\s-]/g, '')
  if (letters.length >= 3 && letters.length <= CODE_LENGTH && [...letters].every((ch) => VOUCHER_CODE_ALPHABET.includes(ch))) {
    or.push({ code: { contains: letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters } })
  }
  return { OR: or }
}

/** Códigos da conta, do mais novo ao mais antigo, por cursor; filtra por situação (EXPIRED é calculada), voucher e busca (código, cliente ou número do pedido). */
export async function listVoucherCodes(
  ctx: TenantContext,
  q: { status?: VoucherCodeStatus; voucherId?: string; search?: string; cursor?: string; limit?: number } = {},
): Promise<{ items: VoucherCodeView[]; nextCursor: string | null }> {
  await guard(ctx)
  const f = parse(listSchema, q)
  const limit = f.limit ?? DEFAULT_LIMIT
  const after = f.cursor === undefined ? null : decodeCursor(f.cursor)
  const now = ctx.clock()
  const live: Prisma.VoucherCodeWhereInput = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
  const where: Prisma.VoucherCodeWhereInput = {
    AND: [
      f.status === 'ACTIVE' ? { status: 'ACTIVE', ...live } : f.status === 'EXPIRED' ? { status: 'ACTIVE', expiresAt: { lte: now } } : f.status !== undefined ? { status: f.status } : {},
      f.voucherId !== undefined ? { voucherId: f.voucherId } : {},
      searchFilter(f.search ?? ''),
      after !== null ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {},
    ],
  }
  const rows = await ctx.db.voucherCode.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: withRelations, take: limit + 1 })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map((r) => toView(ctx, r)), nextCursor: rows.length > limit && last ? encodeCursor(last) : null }
}

/** Os códigos de um pedido (tela do pedido da Loja), na ordem dos itens. */
export async function listCodesOfOrder(ctx: TenantContext, orderId: string): Promise<VoucherCodeView[]> {
  await guard(ctx)
  if (!idSchema.safeParse(orderId).success) throw new DomainError('not_found', 'Pedido não encontrado.')
  orNotFound(await ctx.db.order.findUnique({ where: { id: orderId }, select: { id: true } }), 'Pedido')
  const rows = await ctx.db.voucherCode.findMany({ where: { orderId }, orderBy: [{ orderItem: { position: 'asc' } }, { seq: 'asc' }], include: withRelations })
  return rows.map((r) => toView(ctx, r))
}

/** Os códigos do próprio cliente do app (nunca os de outro). */
export async function listMyVoucherCodes(ctx: TenantContext): Promise<VoucherCodeView[]> {
  await requireModule(ctx, 'vouchers')
  if (ctx.actor.kind !== 'customer') throw new DomainError('forbidden', 'Entre na sua conta para ver os seus vouchers.')
  const rows = await ctx.db.voucherCode.findMany({ where: { customerId: ctx.actor.customerId }, orderBy: [{ createdAt: 'desc' }, { seq: 'asc' }, { id: 'asc' }], include: withRelations, take: 200 })
  return rows.map((r) => toView(ctx, r))
}
