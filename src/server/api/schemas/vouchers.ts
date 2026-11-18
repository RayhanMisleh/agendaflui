import { z } from '@/server/domain/errors'
import type { VoucherCodeView } from '@/server/domain/vouchers/codes'
import { isoInstant, uuid } from '../wire'

/*
 * Esquemas de resposta (formato de fio) dos Vouchers. O estoque nunca sai: só `available` e `maxQuantity`.
 */

export const voucherSchema = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  terms: z.string().nullable().describe('Regras de uso, como dias e horários em que vale.'),
  priceCents: z.number().describe('Preço em centavos.'),
  validDays: z.number().nullable().describe('Dias de validade a partir do pagamento; nulo quando não vence.'),
  available: z.boolean().describe('Há unidades em estoque.'),
  maxQuantity: z.number().describe('Quantidade máxima por pedido: o menor entre o estoque e 99.'),
  imageUrl: z.string().nullable().describe('Endereço absoluto da imagem.'),
  partner: z.object({
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    logoUrl: z.string().nullable().describe('Endereço absoluto do logo.'),
  }),
})

export const voucherCodeSchema = z.object({
  id: uuid,
  code: z.string().describe('O código para mostrar no balcão, no formato XXXX-XXXX.'),
  status: z.enum(['ACTIVE', 'REDEEMED', 'VOID', 'EXPIRED']).describe('ACTIVE: vale; REDEEMED: já usado; VOID: anulado (pedido cancelado ou pagamento devolvido); EXPIRED: passou da validade.'),
  expiresAt: isoInstant.nullable().describe('Fim da validade (23:59:59.999 do último dia, no fuso da conta); nulo quando não vence.'),
  expiresLabel: z.string().nullable().describe('A data de validade pronta para exibir.'),
  redeemedLabel: z.string().nullable().describe('Quando foi usado, pronto para exibir.'),
  voucher: z.object({ id: uuid, name: z.string() }),
  partner: z.object({ name: z.string(), address: z.string().nullable(), phone: z.string().nullable(), website: z.string().nullable() }),
  orderNumber: z.number().describe('Número do pedido em que foi comprado.'),
})

/** O código como o app o vê: sem o cliente (é o próprio) nem o motivo interno da anulação. */
export function toWireVoucherCode(v: VoucherCodeView) {
  return {
    id: v.id,
    code: v.code,
    status: v.status,
    expiresAt: v.expiresAt,
    expiresLabel: v.expiresLabel,
    redeemedLabel: v.redeemedLabel,
    voucher: v.voucher,
    partner: v.partner,
    orderNumber: v.orderNumber,
  }
}
