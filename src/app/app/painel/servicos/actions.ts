'use server'
import { archiveService, createService, moveService, restoreService, updateService } from '@/server/domain/catalog/services'
import type { ServiceInput } from '@/server/domain/catalog/services'
import type { VariantPriceRow } from '@/server/domain/catalog/pricing'
import { erroDeCampo, feito, ler, renomear } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import type { PriceVariant } from '@/server/db/generated/client'
import { NICHES } from '@/server/niches'
import { isServiceIcon } from '@/shared/service-icons'
import { parseMoney } from '@/ui/money'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'

/*
 * Ações da tela de serviços. Todas passam por `tenantAction('manage_catalog')`: quem não pode recebe "sem permissão" e o
 * domínio confere de novo. O formulário leva o `id` em campo escondido; o domínio decide se o serviço existe na conta.
 * O formulário só manda pontos e "só para o clube" com o módulo de fidelidade ligado (campo `loyalty`): sem ele, o que já
 * está gravado fica como está.
 */

/** As linhas de porte do formulário: `v_<VARIANTE>_on` (atende), `v_<VARIANTE>_price` e `v_<VARIANTE>_duration`. */
const VARIANTES: readonly PriceVariant[] = NICHES.PET.variants.map((d) => d.key)
const CAMPOS_DE_PORTE = VARIANTES.flatMap((k) => [`v_${k}_price`, `v_${k}_duration`])
const DADOS = ['id', 'name', 'description', 'icon', 'price', 'durationMin', 'pricingMode', 'rewardPoints', 'loyalty', ...CAMPOS_DE_PORTE] as const
const CAIXAS = ['clubOnly', 'active', ...VARIANTES.map((k) => `v_${k}_on`)] as const
const NOMES_DO_DOMINIO = { priceCents: 'price' }

/** Só as linhas marcadas; preço vazio ou inválido numa linha marcada vira erro no campo da linha. */
function linhasDePorte(v: Campos): VariantPriceRow[] {
  const linhas: VariantPriceRow[] = []
  for (const variant of VARIANTES) {
    if (v[`v_${variant}_on`] !== 'on') continue
    const preco = (v[`v_${variant}_price`] ?? '').trim()
    if (preco === '') throw erroDeCampo(`v_${variant}_price`, 'Informe o preço.')
    const priceCents = parseMoney(preco)
    if (priceCents === null) throw erroDeCampo(`v_${variant}_price`, 'Digite o preço em reais, por exemplo 35,90.')
    const durationMin = Number(v[`v_${variant}_duration`])
    if (!Number.isInteger(durationMin)) throw erroDeCampo(`v_${variant}_duration`, 'Escolha a duração.')
    linhas.push({ variant, priceCents, durationMin })
  }
  return linhas
}

function entrada(v: Campos): ServiceInput {
  if (!isServiceIcon(v.icon ?? '')) throw erroDeCampo('icon', 'Escolha um ícone da lista.')
  const pontos = (v.rewardPoints ?? '').trim()
  const input: ServiceInput = {
    name: v.name ?? '',
    description: v.description ?? '',
    icon: v.icon ?? '',
    active: v.active === 'on',
  }
  if (v.pricingMode === 'BY_VARIANT') {
    input.pricingMode = 'BY_VARIANT'
    input.variantPrices = linhasDePorte(v)
  } else {
    if (v.pricingMode === 'SINGLE') input.pricingMode = 'SINGLE'
    const preco = (v.price ?? '').trim()
    if (preco === '') throw erroDeCampo('price', 'Informe o preço em reais, por exemplo 35,90.')
    const priceCents = parseMoney(preco)
    if (priceCents === null) throw erroDeCampo('price', 'Digite o preço em reais, por exemplo 35,90.')
    const durationMin = Number(v.durationMin)
    if (!Number.isInteger(durationMin)) throw erroDeCampo('durationMin', 'Escolha a duração.')
    input.priceCents = priceCents
    input.durationMin = durationMin
  }
  if (v.loyalty === '1') {
    input.clubOnly = v.clubOnly === 'on'
    input.rewardPoints = pontos === '' ? 0 : Number(pontos)
  }
  return input
}

export const criarServico = tenantAction(
  'manage_catalog',
  (fd) => ler(fd, DADOS, CAIXAS),
  async (ctx, v) => {
    try {
      await createService(ctx, entrada(v), { onGrid: true })
    } catch (err) {
      throw renomear(err, NOMES_DO_DOMINIO)
    }
    atualizarPainel()
    return `${v.name?.trim() ?? 'Serviço'} criado.`
  },
  (mensagem, v) => feito(mensagem, v),
)

export const editarServico = tenantAction(
  'manage_catalog',
  (fd) => ler(fd, DADOS, CAIXAS),
  async (ctx, v) => {
    try {
      await updateService(ctx, v.id ?? '', entrada(v), { onGrid: true })
    } catch (err) {
      throw renomear(err, NOMES_DO_DOMINIO)
    }
    atualizarPainel()
    return `${v.name?.trim() ?? 'Serviço'} salvo.`
  },
  (mensagem, v) => feito(mensagem, v),
)

export const moverServico = tenantAction(
  'manage_catalog',
  (fd) => ler(fd, ['id', 'direction']),
  async (ctx, v) => {
    await moveService(ctx, v.id ?? '', v.direction === 'up' ? 'up' : 'down')
    atualizarPainel()
    return 'Ordem salva.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarServico = tenantAction(
  'manage_catalog',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await archiveService(ctx, v.id ?? '')
    atualizarPainel()
    return 'Serviço arquivado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const restaurarServico = tenantAction(
  'manage_catalog',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await restoreService(ctx, v.id ?? '')
    atualizarPainel()
    return 'Serviço restaurado.'
  },
  (mensagem, v) => feito(mensagem, v),
)
