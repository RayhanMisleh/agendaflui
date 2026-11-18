'use server'
import { advanceFulfillment, cancelOrder } from '@/server/domain/store/orders'
import { simulateApprovedPayment } from '@/server/domain/store/simulate'
import { feito, ler } from '@/app/_lib/campos'
import { tenantAction } from '../../_lib/action'
import { atualizarPainel } from '../../_lib/revalidar'

/*
 * Ações dos pedidos da Loja. Todas por `tenantAction('manage_store')`; o domínio confere de novo a capacidade, o módulo e a
 * conta (pedido de outra conta é `not_found`).
 */

const ETAPAS = ['PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'] as const

export const avancarEntrega = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id', 'to', 'trackingCode']),
  async (ctx, v) => {
    const to = ETAPAS.find((e) => e === v.to)
    // Etapa que não existe vai ao domínio como está e volta como erro de validação.
    await advanceFulfillment(ctx, v.id ?? '', { to: to ?? (v.to as (typeof ETAPAS)[number]), trackingCode: (v.trackingCode ?? '').trim() === '' ? null : (v.trackingCode ?? '') })
    atualizarPainel()
    return 'Entrega atualizada.'
  },
  (mensagem, v) => feito(mensagem, { ...v, trackingCode: '' }),
)

export const cancelarPedido = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id', 'reason']),
  async (ctx, v) => {
    await cancelOrder(ctx, v.id ?? '', { reason: v.reason ?? '' })
    atualizarPainel()
    return 'Pedido cancelado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

/** Só no ambiente de teste (modo falso): o domínio recusa em qualquer outro. */
export const simularPagamento = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await simulateApprovedPayment(ctx, v.id ?? '')
    atualizarPainel()
    return 'Pagamento simulado: o pedido está pago.'
  },
  (mensagem, v) => feito(mensagem, v),
)
