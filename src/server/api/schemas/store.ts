import { z } from '@/server/domain/errors'
import { uuid } from '../wire'

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
