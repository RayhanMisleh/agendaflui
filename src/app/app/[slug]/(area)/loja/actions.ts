'use server'
import { redirect } from 'next/navigation'
import { assertCustomerRate } from '@/server/auth/customer-access'
import { DomainError } from '@/server/domain/errors'
import { createAddress, deleteAddress, updateAddress } from '@/server/domain/store/addresses'
import { assertCartQuantity, MAX_LINES } from '@/server/domain/store/cart'
import { startCheckout } from '@/server/domain/store/checkout'
import { createOrder, type Delivery } from '@/server/domain/store/orders'
import { feito, ler } from '@/app/_lib/campos'
import { clienteAction } from '../../_lib/acao'
import { atualizarLoja } from '../../_lib/revalidar'
import { readCart, writeCart } from './_lib/carrinho'

/*
 * Ações do carrinho da Loja. O carrinho é um cookie `httpOnly` por loja; antes de gravar, o produto é conferido no banco
 * (à venda, desta loja, com estoque): nada de preço nem de nome vem do formulário. O pedido lê o carrinho do cookie, e o frete
 * vai assinado no `quoteToken` da cotação. Endereços: só os do próprio cliente (o domínio confere).
 */

const quantidadeDe = (texto: string | undefined): number => (/^\d{1,3}$/.test((texto ?? '').trim()) ? Number((texto ?? '').trim()) : 0)

export const porNoCarrinho = clienteAction(
  (fd) => ler(fd, ['productId', 'quantity']),
  async (v, c) => {
    const slug = v.store.slug
    const linhas = await readCart()
    const atual = linhas.find((l) => l.productId === (c.productId ?? '').toLowerCase())
    const produto = await assertCartQuantity(v.ctx, c.productId ?? '', (atual?.quantity ?? 0) + quantidadeDe(c.quantity))
    if (!atual && linhas.length >= MAX_LINES) throw new DomainError('conflict', 'O carrinho aceita até 20 produtos diferentes. Tire um para pôr este.')
    const proximas = atual ? linhas.map((l) => (l.productId === atual.productId ? { ...l, quantity: l.quantity + quantidadeDe(c.quantity) } : l)) : [...linhas, { productId: produto.id, quantity: quantidadeDe(c.quantity) }]
    await writeCart(slug, proximas)
    atualizarLoja()
    return `Pôs ${produto.name} no carrinho.`
  },
  (mensagem, c) => feito(mensagem, c),
)

export const mudarQuantidade = clienteAction(
  (fd) => ler(fd, ['productId', 'quantity']),
  async (v, c) => {
    const quantidade = quantidadeDe(c.quantity)
    const id = (c.productId ?? '').toLowerCase()
    const linhas = await readCart()
    if (!linhas.some((l) => l.productId === id)) throw new DomainError('not_found', 'Este item não está no seu carrinho.')
    // Zero tira o item (o "−" em 1 unidade).
    if (quantidade === 0) await writeCart(v.store.slug, linhas.filter((l) => l.productId !== id))
    else {
      await assertCartQuantity(v.ctx, id, quantidade)
      await writeCart(v.store.slug, linhas.map((l) => (l.productId === id ? { ...l, quantity: quantidade } : l)))
    }
    atualizarLoja()
    return 'Carrinho atualizado.'
  },
  (mensagem, c) => feito(mensagem, c),
)

export const tirarDoCarrinho = clienteAction(
  (fd) => ler(fd, ['productId']),
  async (v, c) => {
    const id = (c.productId ?? '').toLowerCase()
    await writeCart(v.store.slug, (await readCart()).filter((l) => l.productId !== id))
    atualizarLoja()
    return 'Item tirado do carrinho.'
  },
  (mensagem, c) => feito(mensagem, c),
)

/**
 * Faz o pedido com o carrinho do cookie e leva ao pagamento (Mercado Pago). O pedido é criado antes: se o pagamento não está
 * disponível, ele fica aguardando e a tela do pedido explica. O carrinho só esvazia depois do pedido gravado. A chave de
 * idempotência (`key`) faz o toque duplo gravar um pedido só.
 */
export const fazerPedido = clienteAction(
  (fd) => ler(fd, ['delivery', 'addressId', 'quoteToken', 'note', 'key']),
  async (v, c) => {
    await assertCustomerRate(v, 'order', v.ctx.clock())
    const linhas = await readCart()
    if (linhas.length === 0) throw new DomainError('conflict', 'Seu carrinho está vazio. Se você acabou de fazer o pedido, ele está em Meus pedidos.')
    const entrega: Delivery = c.delivery === 'SHIPPING' ? { method: 'SHIPPING', addressId: c.addressId ?? '', quoteToken: c.quoteToken ?? '' } : { method: 'PICKUP' }
    const chave = (c.key ?? '').trim()
    const { order } = await createOrder(v.ctx, { lines: linhas, delivery: entrega, note: (c.note ?? '').trim() === '' ? null : (c.note ?? ''), ...(chave !== '' ? { idempotencyKey: chave } : {}) })
    await writeCart(v.store.slug, [])
    atualizarLoja()
    try {
      const pagamento = await startCheckout(v.ctx, order.id, { backPath: `/${v.store.slug}/loja/pedidos/${order.id}` })
      return { orderId: order.id, checkoutUrl: pagamento.checkoutUrl, slug: v.store.slug }
    } catch (err) {
      if (!(err instanceof DomainError) || err.reason !== 'payment_unavailable') throw err
      return { orderId: order.id, checkoutUrl: null, slug: v.store.slug }
    }
  },
  (r) => redirect(r.checkoutUrl ?? `/${r.slug}/loja/pedidos/${r.orderId}?pagamento=indisponivel`),
)

const ENDERECO = ['id', 'label', 'recipientName', 'postalCode', 'street', 'number', 'complement', 'district', 'city', 'state'] as const

/** Cria ou edita um endereço do próprio cliente (com `id`, edita; o domínio recusa o de outro cliente como "não encontrado"). */
export const salvarEndereco = clienteAction(
  (fd) => ler(fd, ENDERECO, ['isDefault']),
  async (v, c) => {
    const dados = {
      label: c.label ?? '',
      recipientName: c.recipientName ?? '',
      postalCode: c.postalCode ?? '',
      street: c.street ?? '',
      number: c.number ?? '',
      complement: c.complement ?? '',
      district: c.district ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      isDefault: c.isDefault === 'on',
    }
    const endereco = (c.id ?? '') === '' ? await createAddress(v.ctx, { ...dados, label: dados.label || null, complement: dados.complement || null }) : await updateAddress(v.ctx, c.id ?? '', { ...dados, label: dados.label || null, complement: dados.complement || null })
    atualizarLoja()
    return endereco.id
  },
  (id, c) => feito('Endereço salvo.', c, { id }),
)

export const apagarEndereco = clienteAction(
  (fd) => ler(fd, ['id']),
  async (v, c) => {
    await deleteAddress(v.ctx, c.id ?? '')
    atualizarLoja()
    return 'Endereço apagado.'
  },
  (mensagem, c) => feito(mensagem, c),
)
