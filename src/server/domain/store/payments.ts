import type { TenantContext } from '@/server/auth/actor'
import { createSystemContext } from '@/server/auth/context'
import type { OrderStatus, PaymentStatus } from '@/server/db/generated/client'
import { authorize, DomainError, orNotFound, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { audit } from '@/server/domain/audit'
import { findMercadoPagoByWebhookKey, readMercadoPagoSecrets } from '@/server/domain/platform/integration-secrets'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { orderPaid, orderVoided } from '@/server/domain/store/order-events'
import { integrations, IntegrationError } from '@/server/integrations'
import { verifyMercadoPagoSignature, type MpPayment } from '@/server/integrations/mercadopago'
import { formatDateTime } from '@/server/time'

export type { PaymentStatus }

const idSchema = z.uuid()
const PROVIDER = 'MERCADO_PAGO' as const
const REFUND_REASON = 'Pagamento devolvido no Mercado Pago'

const STATUS_OF: Record<MpPayment['status'], PaymentStatus> = {
  pending: 'PENDING',
  authorized: 'IN_PROCESS',
  in_process: 'IN_PROCESS',
  in_mediation: 'IN_PROCESS',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  cancelled: 'CANCELED',
  refunded: 'REFUNDED',
  charged_back: 'CHARGED_BACK',
}

/**
 * Ordem das situações de um pagamento: nunca anda para trás. Uma consulta mais velha que chega depois (duas notificações em
 * paralelo) não desfaz o que uma mais nova já gravou, por exemplo reabrir um pedido estornado.
 */
const RANK: Record<PaymentStatus, number> = { PENDING: 0, IN_PROCESS: 1, REJECTED: 2, CANCELED: 2, APPROVED: 3, REFUNDED: 4, CHARGED_BACK: 4 }

function logFailure(event: string, err: unknown): void {
  // Só o nome do erro: a mensagem do Mercado Pago ou do banco pode trazer dado de conta.
  console.error(JSON.stringify({ level: 'error', event, error: err instanceof IntegrationError ? err.code : err instanceof Error ? err.name : 'unknown' }))
}

/**
 * Aplica ao pedido o que o Mercado Pago diz de UM pagamento (sempre o resultado de uma consulta à API, nunca o corpo de um
 * aviso). Roda sob a trava do pedido e é idempotente: o mesmo pagamento repetido ou em paralelo grava uma linha e muda o
 * pedido uma vez. Não confere módulo nem permissão (a Loja desligada e a conta suspensa ainda recebem o dinheiro já pago):
 * quem chama é o sistema. `changed` diz se o pedido (situação ou atenção) mudou.
 */
export async function applyPayment(ctx: TenantContext, orderId: string, payment: MpPayment): Promise<{ orderStatus: OrderStatus; changed: boolean }> {
  if (!idSchema.safeParse(orderId).success) throw new DomainError('not_found', 'Pedido não encontrado.')
  const status = STATUS_OF[payment.status]
  return ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('order', orderId)
    const order = orNotFound(await tx.order.findUnique({ where: { id: orderId }, include: { items: true } }), 'Pedido')
    const unchanged = { orderStatus: order.status, changed: false }
    const now = ctx.clock()
    // Defesa extra: o pagamento só vale para o pedido que ele mesmo diz ser (quem chama já confere, mas aqui não custa nada).
    if (payment.externalReference === null || payment.externalReference.toLowerCase() !== orderId.toLowerCase()) return unchanged

    // O pagamento é gravado pela chave (conta, provedor, id do Mercado Pago). ON CONFLICT DO NOTHING cobre o mesmo id chegando
    // para dois pedidos ao mesmo tempo: o primeiro fica com ele.
    const data = { status, statusDetail: payment.statusDetail, amountCents: payment.amountCents, currency: payment.currency, approvedAt: payment.approvedAt, lastSyncedAt: now }
    let existing = await tx.payment.findFirst({ where: { provider: PROVIDER, providerPaymentId: payment.id } })
    // Este pagamento acabou de ser aprovado (linha nova ou subiu de situação): é o que separa um pagamento a mais de um aviso repetido.
    const previous = existing === null ? null : existing.status
    if (existing === null) {
      await tx.payment.createMany({ data: [{ businessId: ctx.businessId, orderId, provider: PROVIDER, providerPaymentId: payment.id, ...data }], skipDuplicates: true })
      existing = await tx.payment.findFirst({ where: { provider: PROVIDER, providerPaymentId: payment.id } })
    } else if (existing.orderId === orderId && RANK[status] >= RANK[existing.status]) {
      await tx.payment.update({ where: { id: existing.id }, data })
    }
    if (existing === null || existing.orderId !== orderId) return unchanged
    // Consulta mais velha que a já gravada: não decide nada.
    if (RANK[status] < RANK[existing.status]) return unchanged
    const total = order.totalCents
    const newlyApproved = status === 'APPROVED' && (previous === null || RANK[previous] < RANK.APPROVED)
    // Pagamento a mais: pedido que já foi pago (e segue pago ou foi cancelado depois) recebe outro pagamento aprovado.
    const flagDouble = async () => {
      if (order.attention !== null) return unchanged
      await tx.order.update({ where: { id: orderId }, data: { attention: 'double_payment' } })
      await audit(ctx, { action: 'order.double_payment', targetType: 'Order', targetId: orderId, metadata: { totalCents: total, paidCents: payment.amountCents } }, tx)
      return { orderStatus: order.status, changed: true }
    }

    if (status === 'APPROVED') {
      if (payment.amountCents !== total || payment.currency !== 'BRL') {
        // Valor ou moeda diferentes: o pagamento fica registrado e o dono resolve; o pedido não muda.
        if (order.attention !== null) return unchanged
        await tx.order.update({ where: { id: orderId }, data: { attention: 'amount_mismatch' } })
        await audit(ctx, { action: 'order.payment_mismatch', targetType: 'Order', targetId: orderId, metadata: { expectedCents: total, paidCents: payment.amountCents, currency: payment.currency } }, tx)
        return { orderStatus: order.status, changed: true }
      }
      if (order.status === 'PAID') return newlyApproved ? flagDouble() : unchanged
      if (order.status === 'AWAITING_PAYMENT') {
        const { count } = await tx.order.updateMany({ where: { id: orderId, status: 'AWAITING_PAYMENT' }, data: { status: 'PAID', paidAt: now } })
        if (count !== 1) return unchanged
        await orderPaid(tx, ctx, orderId)
        return { orderStatus: 'PAID', changed: true }
      }
      // Pedido que já foi pago uma vez e depois cancelado (pelo dono ou por estorno) NUNCA reabre: o cancelamento é decisão do
      // dono, e um aviso repetido do mesmo pagamento não pode desfazê-lo. Um pagamento NOVO aprovado nele é pagamento a mais.
      if (order.paidAt !== null) return newlyApproved ? flagDouble() : unchanged
      // Vencido ou cancelado antes de pagar e pago mesmo assim: o dinheiro entrou, então o pedido vale. Só reabre se o estoque
      // já voltou.
      if (order.stockReleasedAt === null) return unchanged
      const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      const lines = order.items.flatMap((it) => (it.productId === null ? [] : [{ kind: 'product' as const, id: it.productId, quantity: it.quantity }])).sort(byId)
      // Reserva de novo, em ordem de id (a mesma ordem da criação do pedido), tudo ou nada.
      const reserved: typeof lines = []
      let short = false
      for (const l of lines) {
        const where = { id: l.id, stock: { gte: l.quantity } }
        const data = { stock: { decrement: l.quantity } }
        const { count } = await tx.product.updateMany({ where, data })
        if (count === 0) {
          short = true
          break
        }
        reserved.push(l)
      }
      if (short) {
        for (const l of reserved) {
          await tx.product.updateMany({ where: { id: l.id }, data: { stock: { increment: l.quantity } } })
        }
      }
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paidAt: now,
          canceledAt: null,
          canceledByType: null,
          canceledById: null,
          cancelReason: null,
          stockReleasedAt: short ? order.stockReleasedAt : null,
          attention: short ? 'stock_shortfall' : order.attention,
        },
      })
      await audit(ctx, { action: 'order.reopened_by_payment', targetType: 'Order', targetId: orderId, metadata: { was: order.status, stockShortfall: short } }, tx)
      await orderPaid(tx, ctx, orderId)
      return { orderStatus: 'PAID', changed: true }
    }

    if (status === 'REFUNDED' || status === 'CHARGED_BACK') {
      if (order.status !== 'PAID') return unchanged
      // Outro pagamento aprovado que cobre o pedido inteiro: o estorno deste é de um pagamento a mais.
      const covering = await tx.payment.count({ where: { orderId, status: 'APPROVED', amountCents: total, currency: 'BRL', id: { not: existing.id } } })
      if (covering > 0) return unchanged
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'PAID' },
        data: { status: 'CANCELED', canceledAt: now, canceledByType: 'SYSTEM', canceledById: null, cancelReason: REFUND_REASON },
      })
      if (count !== 1) return unchanged
      await orderVoided(tx, ctx, orderId, 'refunded')
      if (order.fulfillmentStatus !== 'PENDING' && order.deliveryMethod !== 'NONE') await tx.order.update({ where: { id: orderId }, data: { attention: 'payment_reversed' } })
      await audit(ctx, { action: 'order.payment_reversed', targetType: 'Order', targetId: orderId, metadata: { how: status } }, tx)
      return { orderStatus: 'CANCELED', changed: true }
    }

    // pendente, em processamento, rejeitado, cancelado: só o pagamento mudou.
    return unchanged
  }, TX_OPTIONS)
}

/**
 * Confere com o Mercado Pago, pela referência do pedido, os pagamentos que ele tem para o pedido e aplica cada um. Serve à
 * varredura (aviso perdido). `true` = a consulta funcionou (mesmo sem nenhum pagamento); `false` = não deu para consultar
 * (Mercado Pago fora do ar ou sem credenciais legíveis): quem chama deixa o pedido para a próxima rodada.
 */
export async function syncOrderPayments(ctx: TenantContext, orderId: string): Promise<boolean> {
  const secrets = await readMercadoPagoSecrets(ctx.businessId)
  if (secrets === null) return false
  let found: MpPayment[]
  try {
    found = await integrations().mercadoPago.searchPaymentsByReference(secrets.accessToken, orderId)
  } catch (err) {
    logFailure('mp_search_failed', err)
    return false
  }
  for (const p of found) {
    if (p.externalReference !== orderId) continue
    await applyPayment(ctx, orderId, p)
  }
  return true
}

const DATA_ID = /^\d{1,20}$/
const WEBHOOK_KEY = /^[A-Za-z0-9_-]{1,200}$/

/**
 * Aviso do Mercado Pago (`POST /v1/webhooks/mercadopago/{webhookKey}`). A conta vem SÓ da chave do endereço. A assinatura, quando vem, é
 * conferida ANTES de qualquer consulta (sem ela vale a chave da URL); a situação do pagamento vem da consulta à API do Mercado Pago com as credenciais DA
 * CONTA, nunca do corpo do aviso (que nem é lido). Respostas: 404 chave desconhecida; 401 assinatura inválida; 503 consulta
 * falhou (o Mercado Pago tenta de novo); 200 nos demais casos, inclusive o que não é pagamento ou não é desta conta.
 */
export async function handleMercadoPagoNotification(i: {
  webhookKey: string
  dataId: string | null
  type: string | null
  xSignature: string | null
  xRequestId: string | null
}): Promise<{ status: 200 | 401 | 404 | 503 }> {
  if (!WEBHOOK_KEY.test(i.webhookKey)) return { status: 404 }
  const account = await findMercadoPagoByWebhookKey(i.webhookKey)
  if (account === null) return { status: 404 }
  if (i.type !== 'payment') return { status: 200 }
  if (i.dataId === null || i.dataId === '') return { status: 200 }
  // Autenticação: a chave secreta de 256 bits na URL já identifica a conta, e a situação do pagamento SEMPRE vem da consulta à
  // API do Mercado Pago com o token da conta (o corpo e o aviso não decidem nada). Não temos certeza de que os avisos da
  // `notification_url` da preferência venham assinados; por isso, se o `x-signature` vier, ele é verificado (inválido = 401) e,
  // se não vier, o aviso é aceito.
  if (i.xSignature !== null && !verifyMercadoPagoSignature({ secret: account.webhookSecret, xSignature: i.xSignature, xRequestId: i.xRequestId, dataId: i.dataId })) return { status: 401 }
  // O id vai para a URL da consulta: só dígitos, mesmo assinado.
  if (!DATA_ID.test(i.dataId)) return { status: 200 }

  let payment: MpPayment
  try {
    payment = await integrations().mercadoPago.getPayment(account.accessToken, i.dataId)
  } catch (err) {
    logFailure('mp_webhook_lookup_failed', err)
    return { status: 503 }
  }
  if (payment.id !== i.dataId) return { status: 503 }
  const reference = payment.externalReference
  if (reference === null || !idSchema.safeParse(reference).success) {
    console.error(JSON.stringify({ level: 'warn', event: 'mp_webhook_unknown_reference' }))
    return { status: 200 }
  }
  const ctx = await createSystemContext(account.businessId)
  // Só pedido DESTA conta: o cliente por conta não enxerga o de outra.
  if ((await ctx.db.order.findUnique({ where: { id: reference }, select: { id: true } })) === null) {
    console.error(JSON.stringify({ level: 'warn', event: 'mp_webhook_unknown_reference' }))
    return { status: 200 }
  }
  await applyPayment(ctx, reference, payment)
  return { status: 200 }
}

export type OrderPaymentView = { status: PaymentStatus; amountCents: number; providerPaymentId: string; updatedLabel: string }

/** Os pagamentos de um pedido (tela do pedido, só `manage_store`), do mais novo ao mais antigo. */
export async function listOrderPayments(ctx: TenantContext, orderId: string): Promise<OrderPaymentView[]> {
  await requireModule(ctx, 'store')
  authorize(ctx, 'manage_store')
  if (!idSchema.safeParse(orderId).success) throw new DomainError('not_found', 'Pedido não encontrado.')
  orNotFound(await ctx.db.order.findUnique({ where: { id: orderId }, select: { id: true } }), 'Pedido')
  const rows = await ctx.db.payment.findMany({ where: { orderId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })
  return rows.map((p) => ({ status: p.status, amountCents: p.amountCents, providerPaymentId: p.providerPaymentId, updatedLabel: formatDateTime(p.lastSyncedAt, ctx.timeZone) }))
}
