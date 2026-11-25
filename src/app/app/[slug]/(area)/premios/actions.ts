'use server'
import { assertCustomerRate } from '@/server/auth/customer-access'
import { cancelRedemption, redeemPrize } from '@/server/domain/loyalty/redemptions'
import { erroDeCampo, feito, ler } from '@/app/_lib/campos'
import { clienteAction } from '../../_lib/acao'
import { atualizarLoja } from '../../_lib/revalidar'

/*
 * Ações dos Prêmios. O cliente vem sempre da sessão (`clienteAction`): nenhum id de cliente é lido do formulário, e o domínio
 * confere de novo que o prêmio e o resgate são dele.
 */

export const resgatarPremio = clienteAction(
  (fd) => ler(fd, ['prizeId', 'expectedCostPoints', 'key']),
  async (v, c) => {
    await assertCustomerRate(v, 'redeem', v.ctx.clock())
    const custo = (c.expectedCostPoints ?? '').trim()
    if (custo !== '' && !/^\d{1,9}$/.test(custo)) throw erroDeCampo('expectedCostPoints', 'Atualize a página para ver o custo de agora.')
    const chave = (c.key ?? '').trim()
    await redeemPrize(v.ctx, { prizeId: c.prizeId ?? '', ...(custo !== '' ? { expectedCostPoints: Number(custo) } : {}), ...(chave !== '' ? { idempotencyKey: chave } : {}) })
    atualizarLoja()
    return 'Resgate pedido. Retire no balcão.'
  },
  (mensagem, c) => feito(mensagem, c),
)

export const cancelarResgate = clienteAction(
  (fd) => ler(fd, ['id']),
  async (v, c) => {
    await cancelRedemption(v.ctx, c.id ?? '')
    atualizarLoja()
    return 'Resgate cancelado. Os pontos voltaram para você.'
  },
  (mensagem, c) => feito(mensagem, c),
)
