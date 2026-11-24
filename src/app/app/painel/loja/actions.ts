'use server'
import { redirect } from 'next/navigation'
import { archiveCategory, createCategory, moveCategory, renameCategory } from '@/server/domain/store/categories'
import { adjustStock, archiveProduct, createProduct, updateProduct } from '@/server/domain/store/products'
import type { ProductInput } from '@/server/domain/store/products'
import { updateStoreSettings } from '@/server/domain/store/settings'
import { erroDeCampo, feito, ler, renomear } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { parseMoney } from '@/ui/money'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'
import { comConflito } from '../configuracoes/versao'

/*
 * Ações da Loja: produtos, estoque, categorias e configurações. Todas passam por `tenantAction('manage_store')`; o domínio
 * confere de novo a capacidade e o módulo ligado. O dinheiro vem em reais ("19,90") e vira centavos aqui com `parseMoney`,
 * a mesma função do `MoneyField`.
 */

const PRODUTO = ['id', 'name', 'description', 'price', 'promoPrice', 'stock', 'categoryId', 'weightGrams', 'lengthCm', 'heightCm', 'widthCm'] as const
const NOMES_DO_DOMINIO = { priceCents: 'price', promoPriceCents: 'promoPrice' }

function dinheiro(texto: string | undefined, campo: string, obrigatorio: boolean, exemplo: string): number | null {
  const t = (texto ?? '').trim()
  if (t === '') {
    if (obrigatorio) throw erroDeCampo(campo, `Informe o valor em reais, por exemplo ${exemplo}.`)
    return null
  }
  const cents = parseMoney(t)
  if (cents === null) throw erroDeCampo(campo, `Digite o valor em reais, por exemplo ${exemplo}.`)
  return cents
}

function inteiro(texto: string | undefined, campo: string, mensagem: string, obrigatorio: boolean): number | null {
  const t = (texto ?? '').trim()
  if (t === '') {
    if (obrigatorio) throw erroDeCampo(campo, mensagem)
    return null
  }
  if (!/^\d+$/.test(t)) throw erroDeCampo(campo, mensagem)
  return Number(t)
}

function dadosDoProduto(v: Campos): Omit<ProductInput, 'stock'> {
  return {
    categoryId: (v.categoryId ?? '') === '' ? null : (v.categoryId ?? ''),
    name: v.name ?? '',
    description: v.description ?? '',
    priceCents: dinheiro(v.price, 'price', true, '19,90') ?? 0,
    promoPriceCents: dinheiro(v.promoPrice, 'promoPrice', false, '14,90'),
    weightGrams: inteiro(v.weightGrams, 'weightGrams', 'Digite o peso em gramas, só números, ou deixe em branco.', false),
    lengthCm: inteiro(v.lengthCm, 'lengthCm', 'Digite o comprimento em centímetros, só números, ou deixe em branco.', false),
    heightCm: inteiro(v.heightCm, 'heightCm', 'Digite a altura em centímetros, só números, ou deixe em branco.', false),
    widthCm: inteiro(v.widthCm, 'widthCm', 'Digite a largura em centímetros, só números, ou deixe em branco.', false),
    active: v.active === 'on',
  }
}

export const criarProduto = tenantAction(
  'manage_store',
  (fd) => ler(fd, PRODUTO, ['active']),
  async (ctx, v) => {
    const dados = dadosDoProduto(v)
    const stock = inteiro(v.stock, 'stock', 'Digite o estoque como número inteiro, por exemplo 10.', true) ?? 0
    try {
      return (await createProduct(ctx, { ...dados, stock })).id
    } catch (err) {
      throw renomear(err, NOMES_DO_DOMINIO)
    }
  },
  (id) => {
    atualizarPainel()
    redirect(`/painel/loja/produtos/${id}`)
  },
)

/** Salva os dados do produto. O estoque não vai junto: muda por "Ajustar estoque", que não desfaz uma venda feita no meio. */
export const salvarProduto = tenantAction(
  'manage_store',
  (fd) => ler(fd, PRODUTO, ['active']),
  async (ctx, v) => {
    const dados = dadosDoProduto(v)
    try {
      await updateProduct(ctx, v.id ?? '', dados)
    } catch (err) {
      throw renomear(err, NOMES_DO_DOMINIO)
    }
    atualizarPainel()
    return `${v.name?.trim() ?? 'Produto'} salvo.`
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarProduto = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await archiveProduct(ctx, v.id ?? '')
    atualizarPainel()
    return 'Produto arquivado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

/** Entrada ou saída de estoque: número com sinal (`+10`, `-3`) e o motivo. */
export const ajustarEstoque = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id', 'delta', 'reason']),
  async (ctx, v) => {
    const texto = (v.delta ?? '').trim()
    if (!/^[+-]?\d+$/.test(texto)) throw erroDeCampo('delta', 'Digite um número inteiro, como 10 para entrada ou -3 para saída.')
    await adjustStock(ctx, v.id ?? '', Number(texto), v.reason ?? '')
    atualizarPainel()
    return 'Estoque ajustado.'
  },
  (mensagem, v) => feito(mensagem, { ...v, delta: '', reason: '' }),
)

export const criarCategoria = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['name']),
  async (ctx, v) => {
    await createCategory(ctx, { name: v.name ?? '' })
    atualizarPainel()
    return `${v.name?.trim() ?? 'Categoria'} criada.`
  },
  (mensagem, v) => feito(mensagem, { ...v, name: '' }),
)

export const renomearCategoria = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id', 'name']),
  async (ctx, v) => {
    await renameCategory(ctx, v.id ?? '', { name: v.name ?? '' })
    atualizarPainel()
    return 'Categoria renomeada.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const moverCategoria = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id', 'direction']),
  async (ctx, v) => {
    await moveCategory(ctx, v.id ?? '', v.direction === 'up' ? 'up' : 'down')
    atualizarPainel()
    return 'Ordem alterada.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarCategoria = tenantAction(
  'manage_store',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await archiveCategory(ctx, v.id ?? '')
    atualizarPainel()
    return 'Categoria arquivada.'
  },
  (mensagem, v) => feito(mensagem, v),
)

const CONFIGURACOES = ['version', 'pickupInstructions', 'originPostalCode', 'weightGrams', 'lengthCm', 'heightCm', 'widthCm', 'paymentWindowMin'] as const

export const salvarConfiguracoes = tenantAction(
  'manage_store',
  (fd) => ler(fd, CONFIGURACOES, ['pickupEnabled', 'shippingEnabled']),
  async (ctx, v) => {
    const numero = (campo: string, mensagem: string): number => inteiro(v[campo], campo, mensagem, true) ?? 0
    const versao = Number(v.version)
    if (!Number.isInteger(versao) || versao < 0) throw erroDeCampo('version', 'Recarregue a página e tente de novo.')
    try {
      await updateStoreSettings(ctx, versao, {
        pickupEnabled: v.pickupEnabled === 'on',
        pickupInstructions: v.pickupInstructions ?? '',
        shippingEnabled: v.shippingEnabled === 'on',
        originPostalCode: v.originPostalCode ?? '',
        defaultPackage: {
          weightGrams: numero('weightGrams', 'Digite o peso em gramas, só números.'),
          lengthCm: numero('lengthCm', 'Digite o comprimento em centímetros, só números.'),
          heightCm: numero('heightCm', 'Digite a altura em centímetros, só números.'),
          widthCm: numero('widthCm', 'Digite a largura em centímetros, só números.'),
        },
        paymentWindowMin: numero('paymentWindowMin', 'Digite o prazo em minutos, só números.'),
      })
    } catch (err) {
      throw renomear(comConflito(err), { 'defaultPackage.weightGrams': 'weightGrams', 'defaultPackage.lengthCm': 'lengthCm', 'defaultPackage.heightCm': 'heightCm', 'defaultPackage.widthCm': 'widthCm' })
    }
    atualizarPainel()
    return 'Configurações salvas.'
  },
  (mensagem, v) => feito(mensagem, v),
)
