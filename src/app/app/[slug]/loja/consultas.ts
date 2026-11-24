'use server'
import { assertCustomerRate } from '@/server/auth/customer-access'
import { lookupPostalCode } from '@/server/domain/store/addresses'
import { quoteShipping, type ShippingQuote } from '@/server/domain/store/shipping'
import { consultar, type Pedido } from '../_lib/consulta'
import { readCart } from './_lib/carrinho'

/*
 * Consultas que a tela da Loja faz sozinha (CEP e frete). Cada uma confere o cliente da loja, conta no limite da regra e
 * devolve dado ou mensagem (nunca erro cru): o carrinho vem do cookie e o endereço é sempre um dos do próprio cliente.
 */

export type EnderecoDoCep = { street: string; district: string; city: string; state: string }

/** Endereço de um CEP. CEP que não existe volta `endereco: null`; ViaCEP fora do ar, `indisponivel`: a pessoa digita. */
export async function buscarCep(slug: string, cep: string): Promise<Pedido<{ endereco: EnderecoDoCep | null; indisponivel: boolean }>> {
  return consultar(slug, async (v) => {
    await assertCustomerRate(v, 'postalCode', v.ctx.clock())
    const r = await lookupPostalCode(v.ctx, cep)
    return { endereco: r.address ? { street: r.address.street, district: r.address.district, city: r.address.city, state: r.address.state } : null, indisponivel: r.unavailable }
  })
}

/** Cotação de frete do carrinho para um endereço do próprio cliente (cada opção traz o `quoteToken` que o pedido confere). */
export async function cotarFrete(slug: string, addressId: string): Promise<Pedido<{ cotacao: ShippingQuote }>> {
  return consultar(slug, async (v) => {
    await assertCustomerRate(v, 'shippingQuote', v.ctx.clock())
    return { cotacao: await quoteShipping(v.ctx, { addressId, lines: await readCart() }) }
  })
}
