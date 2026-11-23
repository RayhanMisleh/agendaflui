import { z } from '@/server/domain/errors'
import type { OrderView } from '@/server/domain/store/orders'
import { isoInstant, uuid } from '../wire'

/*
 * Esquemas de resposta (formato de fio) da Loja. O estoque do produto nunca sai: só `available` e `maxQuantity`.
 */

export const storeOptionsSchema = z.object({
  pickup: z.object({ enabled: z.boolean(), instructions: z.string().nullable().describe('Onde e quando retirar; nulo se a loja não escreveu instruções.') }),
  shipping: z.object({ enabled: z.boolean().describe('A entrega está ligada e dá para cotar o frete (CEP de origem e Frenet configurados).') }),
  payment: z.object({ available: z.boolean().describe('O pagamento pelo Mercado Pago está configurado.') }),
})

export const storeCategorySchema = z.object({
  id: uuid,
  name: z.string(),
  productCount: z.number().describe('Produtos à venda nesta categoria.'),
})

export const storeProductSchema = z.object({
  id: uuid,
  categoryId: uuid.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().describe('Preço de tabela, em centavos.'),
  promoPriceCents: z.number().nullable().describe('Preço promocional em centavos; nulo quando não há promoção.'),
  finalPriceCents: z.number().describe('O que o cliente paga por unidade: a promoção, se houver, ou o preço.'),
  available: z.boolean().describe('Há unidades em estoque.'),
  maxQuantity: z.number().describe('Quantidade máxima por pedido: o menor entre o estoque e 99.'),
  images: z.array(z.object({ url: z.string().describe('Endereço absoluto da imagem.') })),
})

export const addressSchema = z.object({
  id: uuid,
  label: z.string().nullable(),
  recipientName: z.string(),
  postalCode: z.string().describe('CEP com 8 dígitos, sem traço.'),
  street: z.string(),
  number: z.string(),
  complement: z.string().nullable(),
  district: z.string(),
  city: z.string(),
  state: z.string().describe('Sigla do estado (UF).'),
  isDefault: z.boolean(),
})

export const postalCodeResultSchema = z.object({
  address: z.object({ postalCode: z.string(), street: z.string(), district: z.string(), city: z.string(), state: z.string() }).nullable().describe('Nulo quando o CEP não existe.'),
  unavailable: z.boolean().describe('A consulta de CEP está fora do ar: deixe a pessoa digitar o endereço.'),
})

export const shippingQuoteSchema = z.object({
  pickup: z.object({ available: z.boolean(), instructions: z.string().nullable() }),
  options: z.array(
    z.object({
      serviceCode: z.string(),
      name: z.string(),
      carrier: z.string(),
      priceCents: z.number().describe('Frete em centavos. O valor vale só dentro do `quoteToken`.'),
      days: z.number().describe('Prazo de entrega em dias.'),
      quoteToken: z.string().describe('Cotação assinada pelo servidor, válida por 30 minutos. Mande-o ao criar o pedido com entrega; o app nunca manda o preço do frete.'),
    }),
  ),
  shippingError: z.string().nullable().describe('Por que não há opção de entrega, em frase pronta para o cliente; nulo quando há opções. A retirada, se ligada, segue disponível.'),
})

export const orderSchema = z.object({
  id: uuid,
  number: z.number().describe('Número do pedido na conta, a partir de 1001.'),
  status: z.enum(['AWAITING_PAYMENT', 'PAID', 'CANCELED', 'EXPIRED']),
  fulfillmentStatus: z.enum(['PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED']),
  deliveryMethod: z.enum(['PICKUP', 'SHIPPING', 'NONE']),
  items: z.array(
    z.object({
      kind: z.literal('product'),
      id: uuid,
      name: z.string().describe('Nome do item no momento da compra.'),
      unitPriceCents: z.number().describe('Preço unitário no momento da compra.'),
      quantity: z.number(),
      totalCents: z.number(),
    }),
  ),
  itemsCents: z.number(),
  shippingCents: z.number(),
  totalCents: z.number(),
  shipping: z.object({ serviceName: z.string(), days: z.number(), trackingCode: z.string().nullable() }).nullable(),
  address: z
    .object({ recipientName: z.string(), postalCode: z.string(), street: z.string(), number: z.string(), complement: z.string().nullable(), district: z.string(), city: z.string(), state: z.string() })
    .nullable()
    .describe('Endereço de entrega como era na compra (apagado se o cliente deixar o cadastro).'),
  pickupInstructions: z.string().nullable(),
  customerNote: z.string().nullable(),
  createdLabel: z.string(),
  expiresAt: isoInstant.describe('Fim do prazo para pagar; passado ele, o pedido vence e o estoque volta.'),
  expiresLabel: z.string(),
  paidLabel: z.string().nullable(),
  canceledLabel: z.string().nullable(),
  cancelReason: z.string().nullable(),
  canCancel: z.boolean(),
  canPay: z.boolean(),
})

/** O pedido como o app o vê: sem o cliente (é o próprio) e sem a marca interna "atenção" que só a equipe resolve. */
export function toWireOrder(o: OrderView): Omit<OrderView, 'customer' | 'attention'> {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    fulfillmentStatus: o.fulfillmentStatus,
    deliveryMethod: o.deliveryMethod,
    items: o.items,
    itemsCents: o.itemsCents,
    shippingCents: o.shippingCents,
    totalCents: o.totalCents,
    shipping: o.shipping,
    address: o.address,
    pickupInstructions: o.pickupInstructions,
    customerNote: o.customerNote,
    createdLabel: o.createdLabel,
    expiresAt: o.expiresAt,
    expiresLabel: o.expiresLabel,
    paidLabel: o.paidLabel,
    canceledLabel: o.canceledLabel,
    cancelReason: o.cancelReason,
    canCancel: o.canCancel,
    canPay: o.canPay,
  }
}
