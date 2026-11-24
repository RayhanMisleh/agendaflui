'use server'
import { redirect } from 'next/navigation'
import { DomainError } from '@/server/domain/errors'
import { startCheckout } from '@/server/domain/store/checkout'
import { cancelOrder } from '@/server/domain/store/orders'
import { feito, ler } from '@/app/_lib/campos'
import { clienteAction } from '../../_lib/acao'
import { atualizarLoja } from '../../_lib/revalidar'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const idDoPedido = (id: string | undefined): string => {
  if (id === undefined || !ID.test(id)) throw new DomainError('not_found', 'Pedido não encontrado.')
  return id.toLowerCase()
}

/** "Pagar agora": leva ao Mercado Pago (o domínio só abre o pagamento de pedido do próprio cliente, aguardando e no prazo). */
export const pagarPedido = clienteAction(
  (fd) => ler(fd, ['id']),
  async (v, c) => {
    const id = idDoPedido(c.id)
    return (await startCheckout(v.ctx, id, { backPath: `/${v.store.slug}/loja/pedidos/${id}` })).checkoutUrl
  },
  (url) => redirect(url),
)

/** "Cancelar pedido": só o próprio, só aguardando o pagamento; o estoque volta. */
export const cancelarPedido = clienteAction(
  (fd) => ler(fd, ['id']),
  async (v, c) => {
    await cancelOrder(v.ctx, idDoPedido(c.id))
    atualizarLoja()
    return 'Pedido cancelado.'
  },
  (mensagem, c) => feito(mensagem, c),
)
