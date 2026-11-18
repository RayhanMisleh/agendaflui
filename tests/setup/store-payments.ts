import { createHmac } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { handleMercadoPagoNotification } from '@/server/domain/store/payments'
import { setIntegrationsForTests } from '@/server/integrations'
import { fakeMercadoPago, type FakeMercadoPago } from '@/server/integrations/fakes'
import type { MpPayment } from '@/server/integrations/mercadopago'
import { cenaLoja, configurarIntegracoes, mpSegredoDe, produto, type CenaLoja } from './store'
import { pedidoComRetirada } from './store-orders'

export type CenaPagamento = CenaLoja & { fake: FakeMercadoPago; webhookKey: string; produto: { id: string }; pedido: { id: string; totalCents: number } }

/** Loja com Mercado Pago configurado e falso, um produto (estoque 10) e um pedido de 2 unidades de R$ 25,00 com retirada. */
export async function cenaPagamento(o: { estoque?: number; quantidade?: number } = {}): Promise<CenaPagamento> {
  const c = await cenaLoja()
  await configurarIntegracoes(c.b.id, { mercadoPago: true })
  const fake = fakeMercadoPago()
  setIntegrationsForTests({ mercadoPago: fake })
  const p = await produto(c.dono, { stock: o.estoque ?? 10, priceCents: 2500 })
  const { order } = await pedidoComRetirada(c.ctxCliente, [{ productId: p.id, quantity: o.quantidade ?? 2 }])
  return { ...c, fake, webhookKey: await webhookKeyDe(c.b.id), produto: p, pedido: order }
}

export async function webhookKeyDe(businessId: string): Promise<string> {
  const row = await prisma.businessIntegration.findUniqueOrThrow({ where: { businessId } })
  if (row.mpWebhookKey === null) throw new Error('Sem chave de webhook.')
  return row.mpWebhookKey
}

let seq = 1000
/** Um pagamento do Mercado Pago como a consulta o devolve. */
export function pagamentoMp(pedido: { id: string; totalCents: number }, o: Partial<MpPayment> = {}): MpPayment {
  seq += 1
  return { id: String(seq), status: 'approved', statusDetail: 'accredited', amountCents: pedido.totalCents, currency: 'BRL', externalReference: pedido.id, approvedAt: new Date('2026-11-17T15:10:00Z'), ...o }
}

/** Cabeçalho `x-signature` no formato do Mercado Pago. */
export function assinar(i: { secret?: string; businessId?: string; dataId: string; requestId?: string | null; ts?: string }): string {
  const ts = i.ts ?? '1763392200'
  const manifesto = `id:${i.dataId.toLowerCase()};${i.requestId === null ? '' : `request-id:${i.requestId ?? 'req-1'};`}ts:${ts};`
  return `ts=${ts},v1=${createHmac('sha256', i.secret ?? mpSegredoDe(i.businessId ?? '')).update(manifesto).digest('hex')}`
}

/** Notificação assinada de verdade (segredo da conta por padrão). */
export function notificar(c: { webhookKey: string; b: { id: string } }, dataId: string | null, o: { secret?: string; type?: string | null; assinatura?: boolean; key?: string } = {}) {
  return handleMercadoPagoNotification({
    webhookKey: o.key ?? c.webhookKey,
    dataId,
    type: o.type === undefined ? 'payment' : o.type,
    xSignature: o.assinatura === false || dataId === null ? null : assinar({ dataId, businessId: c.b.id, ...(o.secret ? { secret: o.secret } : {}) }),
    xRequestId: 'req-1',
  })
}
