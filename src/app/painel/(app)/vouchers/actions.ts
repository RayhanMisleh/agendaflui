'use server'
import { redirect } from 'next/navigation'
import { feito, ler, erroDeCampo, renomear } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { findVoucherCode, redeemVoucherCode } from '@/server/domain/vouchers/codes'
import type { VoucherCodeView } from '@/server/domain/vouchers/codes'
import { archivePartner, createPartner, updatePartner } from '@/server/domain/vouchers/partners'
import type { PartnerInput } from '@/server/domain/vouchers/partners'
import { archiveVoucher, createVoucher, updateVoucher } from '@/server/domain/vouchers/vouchers'
import type { VoucherInput } from '@/server/domain/vouchers/vouchers'
import { parseMoney } from '@/ui/money'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'

/*
 * Ações dos Vouchers. Todas passam por `tenantAction('manage_vouchers')`; o domínio confere de novo a capacidade, o módulo
 * ligado e a conta (registro de outra conta é `not_found`). O dinheiro vem em reais ("120,00") e vira centavos com
 * `parseMoney`, a mesma função do `MoneyField`. O código digitado nunca vai para log nem auditoria.
 */

// ---------------------------------------------------------------- balcão

/** O que o cartão do balcão diz de um código, em uma frase. */
function fraseDoCodigo(v: VoucherCodeView): string {
  if (v.status === 'ACTIVE') return `Código válido: ${v.voucher.name} de ${v.partnerName}, comprado por ${v.customer.name}.`
  if (v.status === 'REDEEMED') return `Este código já foi usado em ${v.redeemedLabel ?? 'outra data'}.`
  if (v.status === 'VOID') return `Este código foi anulado${v.voidReason ? ` (${v.voidReason})` : ''}. Não dá para dar baixa.`
  return `Este código venceu em ${v.expiresLabel ?? 'outra data'}. Não dá para dar baixa.`
}

/** Consulta o código e mostra o cartão (válido, já usado, anulado ou vencido). Não muda nada. */
export const consultarCodigo = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, ['code']),
  (ctx, v) => findVoucherCode(ctx, v.code ?? ''),
  (view) => feito(fraseDoCodigo(view), { code: view.code, status: view.status }),
)

/** Dá baixa no código (uma vez só). Recusa vira texto: já usado, anulado, vencido ou não encontrado. */
export const darBaixa = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, ['code']),
  async (ctx, v) => {
    const view = await redeemVoucherCode(ctx, v.code ?? '')
    atualizarPainel()
    return view
  },
  (view) => feito(`Baixa feita: ${view.voucher.name} de ${view.partnerName}.`, { code: '', status: 'REDEEMED' }),
)

// ---------------------------------------------------------------- parceiros

const PARCEIRO = ['id', 'name', 'description', 'address', 'phone', 'website'] as const

const dadosDoParceiro = (v: Campos): PartnerInput => ({
  name: v.name ?? '',
  description: v.description ?? '',
  address: v.address ?? '',
  phone: v.phone ?? '',
  website: v.website ?? '',
  active: v.active === 'on',
})

export const criarParceiro = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, PARCEIRO, ['active']),
  async (ctx, v) => (await createPartner(ctx, dadosDoParceiro(v))).id,
  (id) => {
    atualizarPainel()
    redirect(`/vouchers/parceiros/${id}`)
  },
)

export const salvarParceiro = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, PARCEIRO, ['active']),
  async (ctx, v) => {
    await updatePartner(ctx, v.id ?? '', dadosDoParceiro(v))
    atualizarPainel()
    return `${v.name?.trim() ?? 'Parceiro'} salvo.`
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarParceiro = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await archivePartner(ctx, v.id ?? '')
    atualizarPainel()
    return 'Parceiro arquivado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- vouchers

const VOUCHER = ['id', 'partnerId', 'name', 'description', 'terms', 'price', 'stock', 'expectedStock', 'validDays'] as const
const NOMES_DO_DOMINIO = { priceCents: 'price', validDays: 'validDays' }

function inteiro(texto: string | undefined, campo: string, mensagem: string, obrigatorio: boolean): number | null {
  const t = (texto ?? '').trim()
  if (t === '') {
    if (obrigatorio) throw erroDeCampo(campo, mensagem)
    return null
  }
  if (!/^\d+$/.test(t)) throw erroDeCampo(campo, mensagem)
  return Number(t)
}

function dadosDoVoucher(v: Campos): Omit<VoucherInput, 'stock'> {
  const preco = (v.price ?? '').trim()
  const cents = preco === '' ? null : parseMoney(preco)
  if (cents === null) throw erroDeCampo('price', 'Digite o preço em reais, por exemplo 120,00.')
  return {
    partnerId: v.partnerId ?? '',
    name: v.name ?? '',
    description: v.description ?? '',
    terms: v.terms ?? '',
    priceCents: cents,
    validDays: inteiro(v.validDays, 'validDays', 'Digite a validade em dias, só números, ou deixe em branco.', false),
    active: v.active === 'on',
  }
}

export const criarVoucher = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, VOUCHER, ['active']),
  async (ctx, v) => {
    const dados = dadosDoVoucher(v)
    const stock = inteiro(v.stock, 'stock', 'Digite o estoque como número inteiro, por exemplo 10.', true) ?? 0
    try {
      return (await createVoucher(ctx, { ...dados, stock })).id
    } catch (err) {
      throw renomear(err, NOMES_DO_DOMINIO)
    }
  },
  (id) => {
    atualizarPainel()
    redirect(`/vouchers/${id}`)
  },
)

/** Salva o voucher. O estoque vai com o valor que o formulário leu (`expectedStock`): uma venda no meio recusa a gravação. */
export const salvarVoucher = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, VOUCHER, ['active']),
  async (ctx, v) => {
    const dados = dadosDoVoucher(v)
    const stock = inteiro(v.stock, 'stock', 'Digite o estoque como número inteiro, por exemplo 10.', true) ?? 0
    const expectedStock = inteiro(v.expectedStock, 'stock', 'Recarregue a página e tente de novo.', true) ?? 0
    try {
      await updateVoucher(ctx, v.id ?? '', { ...dados, stock, expectedStock })
    } catch (err) {
      throw renomear(err, NOMES_DO_DOMINIO)
    }
    atualizarPainel()
    return `${v.name?.trim() ?? 'Voucher'} salvo.`
  },
  (mensagem, v) => feito(mensagem, { ...v, expectedStock: v.stock ?? '' }),
)

export const arquivarVoucher = tenantAction(
  'manage_vouchers',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await archiveVoucher(ctx, v.id ?? '')
    atualizarPainel()
    return 'Voucher arquivado.'
  },
  (mensagem, v) => feito(mensagem, v),
)
