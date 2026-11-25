import 'server-only'
import type { TenantContext } from '@/server/auth/actor'
import { DomainError } from '@/server/domain/errors'
import { priceCart, type RawCartLine } from '@/server/domain/store/cart'
import { getPublicProduct } from '@/server/domain/store/products'

export type ItemDoCarrinho = {
  productId: string
  quantity: number
  name: string
  imageUrl: string | null
  unitCents: number
  totalCents: number
  /** Até quantas unidades dá para ter agora (estoque e teto por linha). */
  max: number
  /** Por que esta linha trava o pedido, em frase pronta; `null` quando está tudo certo. */
  problema: string | null
}

export type ResumoDoCarrinho = { itens: ItemDoCarrinho[]; subtotalCents: number; podeContinuar: boolean }

/**
 * O carrinho como a tela o mostra: cada linha conferida contra o banco (à venda, com estoque) e o subtotal preçado pelo
 * servidor. Produto que saiu da loja aparece como "não está mais à venda" (com "Tirar"): o cookie não muda numa tela, só em
 * ação, então a linha velha continua visível até a pessoa tirar. Nada aqui grava.
 */
export async function resumirCarrinho(ctx: TenantContext, linhas: RawCartLine[]): Promise<ResumoDoCarrinho> {
  const itens: ItemDoCarrinho[] = []
  for (const l of linhas) {
    try {
      const p = await getPublicProduct(ctx, l.productId)
      const problema = !p.available ? `${p.name} está esgotado.` : l.quantity > p.maxQuantity ? `Só ${p.maxQuantity === 1 ? 'resta 1 unidade' : `restam ${p.maxQuantity} unidades`} de ${p.name}.` : null
      itens.push({ productId: l.productId, quantity: l.quantity, name: p.name, imageUrl: p.images[0]?.url ?? null, unitCents: p.finalPriceCents, totalCents: p.finalPriceCents * l.quantity, max: p.maxQuantity, problema })
    } catch (err) {
      if (!(err instanceof DomainError) || err.code !== 'not_found') throw err
      itens.push({ productId: l.productId, quantity: l.quantity, name: 'Produto indisponível', imageUrl: null, unitCents: 0, totalCents: 0, max: 0, problema: 'Este produto não está mais à venda. Tire-o do carrinho.' })
    }
  }
  const aVenda = itens.filter((i) => i.max > 0 || i.problema === null)
  let subtotalCents = aVenda.reduce((soma, i) => soma + i.totalCents, 0)
  if (aVenda.length > 0) {
    try {
      subtotalCents = (await priceCart(ctx, aVenda.map((i) => ({ productId: i.productId, quantity: i.quantity })))).itemsCents
    } catch (err) {
      // Um produto saiu no meio: vale a soma local até a próxima leitura.
      if (!(err instanceof DomainError)) throw err
    }
  }
  return { itens, subtotalCents, podeContinuar: itens.length > 0 && itens.every((i) => i.problema === null) }
}
