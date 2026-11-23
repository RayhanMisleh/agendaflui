import type { TenantContext } from '@/server/auth/actor'
import { areaLink } from '@/server/area-links'
import { DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { readMercadoPagoSecrets, readMercadoPagoWebhookKey } from '@/server/domain/platform/integration-secrets'
import { ownCustomerId } from '@/server/domain/store/addresses'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { MIN_PAYMENT_WINDOW_MIN } from '@/server/domain/store/settings'
import { integrations, IntegrationError } from '@/server/integrations'
import { addMinutes, formatDateTime, fromEpochMs } from '@/server/time'

const MSG_INDISPONIVEL = 'O pagamento pela loja não está disponível agora. Fale com o estabelecimento.'
const idSchema = z.uuid()

const unavailable = (): DomainError => new DomainError('conflict', MSG_INDISPONIVEL, { reason: 'payment_unavailable' })
const invalidTransition = (message: string): DomainError => new DomainError('conflict', message, { reason: 'invalid_transition' })

const MSG_VOLTA = 'Informe um caminho de retorno válido.'
// Caminho relativo no app (sem host): começa por barra, sem barras duplas nem pontos.
const backPathSchema = z.object({
  backPath: z
    .string('Informe o caminho de retorno em texto.')
    .regex(/^\/[a-z0-9][a-z0-9/-]{0,199}$/, MSG_VOLTA)
    .refine((v) => !v.includes('//'), MSG_VOLTA)
    .nullable()
    .optional(),
})

/**
 * Começa o pagamento de um pedido do cliente pelo Checkout Pro do Mercado Pago. Só o próprio cliente, só pedido aguardando
 * pagamento e dentro do prazo. O servidor monta a preferência com os itens do pedido (e o frete) e confere que somam o total
 * ANTES de enviar. A preferência é criada uma vez: as chamadas seguintes devolvem o mesmo endereço. Falha do Mercado Pago ou
 * falta de configuração é `payment_unavailable` e o pedido não muda.
 */
export async function startCheckout(
  ctx: TenantContext,
  orderId: string,
  i: { backPath?: string | null } = {},
): Promise<{ checkoutUrl: string; expiresAt: Date; expiresLabel: string }> {
  const customerId = await ownCustomerId(ctx)
  const { backPath } = parse(backPathSchema, { backPath: i.backPath })
  const backUrl = backPath === null || backPath === undefined || backPath === '' ? null : areaLink('app', backPath)
  if (!idSchema.safeParse(orderId).success) throw new DomainError('not_found', 'Pedido não encontrado.')
  const order = orNotFound(await ctx.db.order.findFirst({ where: { id: orderId, customerId }, include: { items: { orderBy: { position: 'asc' } }, customer: { select: { email: true } } } }), 'Pedido')
  const now = ctx.clock()
  if (order.status !== 'AWAITING_PAYMENT') throw invalidTransition('Este pedido não aguarda mais o pagamento.')
  if (order.expiresAt.getTime() <= now.getTime()) throw invalidTransition('O prazo para pagar este pedido venceu. Faça um novo pedido.')
  const done = (url: string) => ({ checkoutUrl: url, expiresAt: order.expiresAt, expiresLabel: formatDateTime(order.expiresAt, ctx.timeZone) })
  if (order.checkoutUrl !== null && order.mpPreferenceId !== null) return done(order.checkoutUrl)

  const secrets = await readMercadoPagoSecrets(ctx.businessId)
  const webhookKey = await readMercadoPagoWebhookKey(ctx.businessId)
  if (secrets === null || webhookKey === null) throw unavailable()

  const items = [
    ...order.items.map((it) => ({ id: it.productId ?? it.id, title: it.name, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
    ...(order.shippingCents > 0 ? [{ id: 'shipping', title: 'Frete', quantity: 1, unitPriceCents: order.shippingCents }] : []),
  ]
  // O que vai para o Mercado Pago tem de fechar com o total do pedido; senão nada sai daqui.
  if (items.reduce((sum, it) => sum + it.quantity * it.unitPriceCents, 0) !== order.totalCents) throw unavailable()

  let created: { preferenceId: string; checkoutUrl: string }
  try {
    created = await integrations().mercadoPago.createPreference(secrets.accessToken, {
      orderId: order.id,
      items,
      payerEmail: order.customer.email,
      notificationUrl: areaLink('app', `/webhooks/mercadopago/${webhookKey}`),
      backUrl,
      // O Pix exige pelo menos 30 minutos: o pagamento que chega depois do prazo do pedido segue a regra "pago depois de vencer".
      expiresAt: fromEpochMs(Math.max(order.expiresAt.getTime(), addMinutes(now, MIN_PAYMENT_WINDOW_MIN).getTime())),
    })
  } catch (err) {
    // Só o nome do erro: nada do que o Mercado Pago respondeu nem o token.
    console.error(JSON.stringify({ level: 'error', event: 'mp_create_preference_failed', error: err instanceof IntegrationError ? err.code : err instanceof Error ? err.name : 'unknown' }))
    throw unavailable()
  }

  // A primeira preferência gravada vale; quem chegou depois devolve a que já estava (preferência a mais fica sem uso e vence).
  const kept = await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('order', order.id)
    const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, checkoutUrl: true, mpPreferenceId: true } })
    if (current.status !== 'AWAITING_PAYMENT') throw invalidTransition('Este pedido não aguarda mais o pagamento.')
    if (current.checkoutUrl !== null && current.mpPreferenceId !== null) return current.checkoutUrl
    await tx.order.update({ where: { id: order.id }, data: { mpPreferenceId: created.preferenceId, checkoutUrl: created.checkoutUrl } })
    return created.checkoutUrl
  }, TX_OPTIONS)
  return done(kept)
}
