'use server'
import { assertCartQuantity, MAX_LINES } from '@/server/domain/store/cart'
import { DomainError } from '@/server/domain/errors'
import { feito, ler } from '@/app/_lib/campos'
import { clienteAction } from '../_lib/acao'
import { atualizarLoja } from '../_lib/revalidar'
import { readCart, writeCart } from './_lib/carrinho'

/*
 * Ações do carrinho da Loja. O carrinho é um cookie `httpOnly` por loja; antes de gravar, o produto é conferido no banco
 * (à venda, desta loja, com estoque): nada de preço nem de nome vem do formulário. O pedido e os endereços vêm na Tarefa 16.
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
