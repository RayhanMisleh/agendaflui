import { prisma } from '@/server/db/client'
import type { TenantContext } from '@/server/auth/actor'
import { createAddress, type AddressInput } from '@/server/domain/store/addresses'
import { createOrder } from '@/server/domain/store/orders'
import { quoteShipping } from '@/server/domain/store/shipping'
import { updateStoreSettings } from '@/server/domain/store/settings'
import { configurarIntegracoes, ligarEntrega, type CenaLoja } from './store'

export const ENDERECO: AddressInput = {
  label: 'Casa',
  recipientName: 'Maria da Silva',
  postalCode: '20040-020',
  street: 'Rua da Quitanda',
  number: '10',
  complement: 'Sala 2',
  district: 'Centro',
  city: 'Rio de Janeiro',
  state: 'RJ',
  isDefault: true,
}

/** Retirada ligada (padrão) e entrega pronta para cotar: CEP de origem e token da Frenet configurados. */
export async function prepararEntrega(c: CenaLoja): Promise<void> {
  await ligarEntrega(c.b.id)
  await configurarIntegracoes(c.b.id, { frenet: true })
}

/** Cria o endereço do cliente (padrão do `ENDERECO`) e devolve o id. */
export async function enderecoDe(ctx: TenantContext, o: Partial<AddressInput> = {}): Promise<string> {
  return (await createAddress(ctx, { ...ENDERECO, ...o })).id
}

/** Pedido com retirada no local, já criado. */
export async function pedidoComRetirada(ctx: TenantContext, lines: { productId: string; quantity: number }[], o: { note?: string | null; idempotencyKey?: string } = {}) {
  return createOrder(ctx, { lines, delivery: { method: 'PICKUP' }, note: o.note ?? null, ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}) })
}

/** Cota e devolve o token da opção `serviceCode` (PAC por padrão). */
export async function cotar(ctx: TenantContext, addressId: string, lines: { productId: string; quantity: number }[], serviceCode = 'PAC'): Promise<string> {
  const q = await quoteShipping(ctx, { addressId, lines })
  const opcao = q.options.find((o) => o.serviceCode === serviceCode)
  if (!opcao) throw new Error(`Sem opção ${serviceCode}: ${q.shippingError ?? 'lista vazia'}`)
  return opcao.quoteToken
}

/** Marca o pedido como pago por gravação direta (o pagamento de verdade é da Tarefa 7). */
export async function marcarPago(orderId: string, o: { fulfillment?: 'PENDING' | 'READY_FOR_PICKUP' | 'SHIPPED' | 'DELIVERED'; paidAt?: Date } = {}) {
  await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: o.paidAt ?? new Date(), fulfillmentStatus: o.fulfillment ?? 'PENDING' } })
}

export const estoque = async (productId: string): Promise<number> => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock

export { updateStoreSettings }
