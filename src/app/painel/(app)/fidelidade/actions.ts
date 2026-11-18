'use server'
import { redirect } from 'next/navigation'
import { adjustPoints } from '@/server/domain/loyalty/ledger'
import { archivePrize, createPrize, movePrize, updatePrize } from '@/server/domain/loyalty/prizes'
import type { PrizeInput } from '@/server/domain/loyalty/prizes'
import { cancelRedemption, deliverRedemption, redeemPrize } from '@/server/domain/loyalty/redemptions'
import { updateLoyaltySettings } from '@/server/domain/loyalty/settings'
import { erroDeCampo, feito, ler } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'
import { comConflito } from '../configuracoes/versao'

/*
 * Ações da Fidelidade: prêmios, resgates, ranking e, na ficha do cliente, ajuste de pontos e resgate no balcão. Todas
 * passam por `tenantAction('manage_loyalty')`; o domínio confere de novo a capacidade e o módulo ligado.
 */

const PREMIO = ['id', 'name', 'description', 'costPoints', 'stock', 'expectedStock'] as const

function entradaDoPremio(v: Campos): PrizeInput {
  const estoque = (v.stock ?? '').trim()
  if (estoque !== '' && !/^\d+$/.test(estoque)) throw erroDeCampo('stock', 'Digite o estoque como número inteiro ou deixe em branco para não ter limite.')
  return {
    name: v.name ?? '',
    description: v.description ?? '',
    costPoints: Number((v.costPoints ?? '').trim()),
    stock: estoque === '' ? null : Number(estoque),
    active: v.active === 'on',
  }
}

export const criarPremio = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, PREMIO, ['active']),
  async (ctx, v) => (await createPrize(ctx, entradaDoPremio(v))).id,
  (id) => {
    atualizarPainel()
    redirect(`/fidelidade/premios/${id}`)
  },
)

export const salvarPremio = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, PREMIO, ['active']),
  async (ctx, v) => {
    // `expectedStock` é o estoque que o formulário leu ("sem" = sem limite): se mudou no meio, o domínio devolve conflito.
    const lido = (v.expectedStock ?? '').trim()
    const esperado = lido === '' ? {} : lido === 'sem' ? { expectedStock: null } : /^\d+$/.test(lido) ? { expectedStock: Number(lido) } : {}
    await updatePrize(ctx, v.id ?? '', { ...entradaDoPremio(v), ...esperado })
    atualizarPainel()
    return `${v.name?.trim() ?? 'Prêmio'} salvo.`
  },
  (mensagem, v) => feito(mensagem, v),
)

export const moverPremio = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, ['id', 'direction']),
  async (ctx, v) => {
    await movePrize(ctx, v.id ?? '', v.direction === 'up' ? 'up' : 'down')
    atualizarPainel()
    return 'Ordem alterada.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarPremio = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await archivePrize(ctx, v.id ?? '')
    atualizarPainel()
    return 'Prêmio arquivado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const entregarResgate = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await deliverRedemption(ctx, v.id ?? '')
    atualizarPainel()
    return 'Resgate entregue.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const cancelarResgate = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, ['id', 'reason']),
  async (ctx, v) => {
    await cancelRedemption(ctx, v.id ?? '', { reason: v.reason ?? '' })
    atualizarPainel()
    return 'Resgate cancelado e pontos devolvidos.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const salvarRanking = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, ['version'], ['rankingEnabled']),
  async (ctx, v) => {
    try {
      await updateLoyaltySettings(ctx, Number(v.version), { rankingEnabled: v.rankingEnabled === 'on' })
    } catch (err) {
      throw comConflito(err)
    }
    atualizarPainel()
    return 'Ajustes salvos.'
  },
  (mensagem, v) => feito(mensagem, v),
)

/** Ajuste manual na ficha do cliente: valor inteiro com sinal (`+25`, `-5`) e motivo. */
export const ajustarPontos = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, ['customerId', 'points', 'reason', 'requestId']),
  async (ctx, v) => {
    const texto = (v.points ?? '').trim()
    if (!/^[+-]?\d+$/.test(texto)) throw erroDeCampo('points', 'Digite um número inteiro, como 50 ou -20.')
    await adjustPoints(ctx, { customerId: v.customerId ?? '', points: Number(texto), reason: v.reason ?? '', ...((v.requestId ?? '') === '' ? {} : { requestId: v.requestId ?? '' }) })
    atualizarPainel()
    return 'Ajuste registrado.'
  },
  (mensagem, v) => feito(mensagem, { ...v, points: '', reason: '' }),
)

export const resgatarNoBalcao = tenantAction(
  'manage_loyalty',
  (fd) => ler(fd, ['customerId', 'prizeId', 'requestId', 'expectedCostPoints'], ['deliverNow']),
  async (ctx, v) => {
    if ((v.prizeId ?? '') === '') throw erroDeCampo('prizeId', 'Escolha um prêmio.')
    const custo = (v.expectedCostPoints ?? '').trim()
    if (custo !== '' && !/^\d{1,9}$/.test(custo)) throw erroDeCampo('prizeId', 'Não foi possível conferir o custo do prêmio. Feche e abra de novo.')
    // A chave nasce quando a folha abre: reenviar o mesmo formulário devolve o mesmo resgate, sem debitar de novo.
    // O custo é o que a opção escolhida mostrava: se mudou no meio, o domínio recusa em vez de debitar outro valor.
    await redeemPrize(ctx, {
      prizeId: v.prizeId ?? '',
      customerId: v.customerId ?? '',
      deliverNow: v.deliverNow === 'on',
      ...((v.requestId ?? '') === '' ? {} : { idempotencyKey: v.requestId ?? '' }),
      ...(custo === '' ? {} : { expectedCostPoints: Number(custo) }),
    })
    atualizarPainel()
    return v.deliverNow === 'on' ? 'Resgate registrado e entregue.' : 'Resgate registrado. Falta entregar.'
  },
  (mensagem, v) => feito(mensagem, v),
)
