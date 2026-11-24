import { createHash } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { DomainError, parse, z } from '@/server/domain/errors'
import { requireModule } from '@/server/domain/modules'
import { getPublicProduct, PUBLIC_PRODUCT_FILTER, type PublicProduct } from '@/server/domain/store/products'
import { loadStoreSettings } from '@/server/domain/store/settings'

/** Uma linha do carrinho como o app a manda: só o produto e a quantidade. Preço, nome e medidas vêm sempre do banco. */
export type CartLine = { productId: string; quantity: number }

/** A linha como chega de fora (corpo da API). */
export type RawCartLine = { productId: string; quantity: number }

/** Chave de uma linha, para ordenar, repetir e assinar. */
export function lineKey(l: CartLine): string {
  return l.productId
}

export type PricedProductLine = {
  kind: 'product'
  id: string
  name: string
  unitPriceCents: number
  quantity: number
  totalCents: number
  weightGrams: number
  lengthCm: number
  heightCm: number
  widthCm: number
}

export type PricedLine = PricedProductLine

export type PricedCart = {
  lines: PricedLine[]
  itemsCents: number
  /** Algum item precisa de entrega (todo produto é físico). */
  physical: boolean
  /** SHA-256 do carrinho normalizado: é o que a cotação assinada de frete guarda para só valer para este carrinho. */
  hash: string
}

type Db = TenantClient | TenantTx

export const MAX_LINES = 20
export const MAX_QUANTITY = 99
/** Teto do valor dos itens (R$ 10 milhões): fica folgado dentro do inteiro do banco e nenhum pedido real chega perto. */
const MAX_ITEMS_CENTS = 1_000_000_000

const linesSchema = z.object({
  lines: z
    .array(
      z.strictObject({
        productId: z.uuid('Escolha um produto válido.'),
        quantity: z
          .number('Informe a quantidade.')
          .int('Informe a quantidade em unidades inteiras.')
          .min(1, 'A quantidade mínima é 1.')
          .max(MAX_QUANTITY, 'A quantidade máxima é 99 por produto.'),
      }),
      'Informe os itens do carrinho.',
    )
    .min(1, 'Coloque ao menos um item no carrinho.')
    .max(MAX_LINES, 'O carrinho aceita até 20 produtos diferentes.'),
})

function fieldError(field: string, message: string): DomainError {
  return new DomainError('validation', message, { fields: { [field]: message } })
}

/** Confere o formato das linhas (1 a 20, sem produto repetido, quantidade de 1 a 99) e normaliza o id para minúsculas. */
export function normalizeLines(lines: RawCartLine[]): CartLine[] {
  const raw = parse(linesSchema, { lines }).lines
  const parsed: CartLine[] = []
  const seen = new Set<string>()
  for (const [i, l] of raw.entries()) {
    const line: CartLine = { productId: l.productId.toLowerCase(), quantity: l.quantity }
    const key = lineKey(line)
    if (seen.has(key)) throw fieldError(`lines.${i}.productId`, 'Este item aparece mais de uma vez no carrinho. Some as quantidades em uma linha só.')
    seen.add(key)
    parsed.push(line)
  }
  return parsed
}

function cartHash(lines: CartLine[]): string {
  const text = [...lines]
    .sort((a, b) => (lineKey(a) < lineKey(b) ? -1 : lineKey(a) > lineKey(b) ? 1 : 0))
    .map((l) => `${lineKey(l)}:${l.quantity}`)
    .join(',')
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Preça o carrinho com o que está no BANCO: nome, preço final (promoção ou preço) e medidas de cada produto (ou do pacote
 * padrão da loja). Produto inativo, arquivado, de categoria arquivada ou de outra conta não entra. Não olha o estoque: quem
 * reserva é o pedido, sob trava.
 */
export async function priceCart(ctx: TenantContext, lines: RawCartLine[], db: Db = ctx.db): Promise<PricedCart> {
  await requireModule(ctx, 'store', db)
  const wanted = normalizeLines(lines)
  const productIds = wanted.map((l) => l.productId)
  const rows = await db.product.findMany({ where: { AND: [{ id: { in: productIds } }, PUBLIC_PRODUCT_FILTER] } })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const pack = (await loadStoreSettings(ctx, db)).defaultPackage
  const priced: PricedLine[] = []
  for (const [i, l] of wanted.entries()) {
    const p = byId.get(l.productId)
    if (p === undefined) throw fieldError(`lines.${i}.productId`, 'Um dos produtos do carrinho não está mais à venda. Tire-o do carrinho e tente de novo.')
    const unitPriceCents = p.promoPriceCents ?? p.priceCents
    priced.push({
      kind: 'product',
      id: p.id,
      name: p.name,
      unitPriceCents,
      quantity: l.quantity,
      totalCents: unitPriceCents * l.quantity,
      weightGrams: p.weightGrams ?? pack.weightGrams,
      lengthCm: p.lengthCm ?? pack.lengthCm,
      heightCm: p.heightCm ?? pack.heightCm,
      widthCm: p.widthCm ?? pack.widthCm,
    })
  }
  const itemsCents = priced.reduce((sum, l) => sum + l.totalCents, 0)
  if (itemsCents > MAX_ITEMS_CENTS) throw fieldError('lines', 'O valor do carrinho passa do limite. Tire alguns itens e tente de novo.')
  return { lines: priced, itemsCents, physical: priced.length > 0, hash: cartHash(wanted) }
}

/**
 * Dá para ter `quantity` unidades deste produto no carrinho? O produto precisa estar à venda e com estoque (a reserva de
 * verdade é a do pedido, sob trava: aqui só se avisa cedo, na hora de pôr ou mudar a quantidade). Devolve o produto como o app
 * o vê. Produto inexistente, arquivado ou de outra loja: `not_found` ("Produto não encontrado.").
 */
export async function assertCartQuantity(ctx: TenantContext, productId: string, quantity: number): Promise<PublicProduct> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw fieldError('quantity', 'Informe a quantidade, de 1 a 99.')
  const product = await getPublicProduct(ctx, productId)
  if (!product.available) throw new DomainError('conflict', `${product.name} está esgotado.`, { reason: 'out_of_stock' })
  if (quantity > product.maxQuantity) {
    const resta = product.maxQuantity === 1 ? 'Só resta 1 unidade' : `Só restam ${product.maxQuantity} unidades`
    throw new DomainError('conflict', `${resta} de ${product.name}.`, { reason: 'out_of_stock' })
  }
  return product
}
