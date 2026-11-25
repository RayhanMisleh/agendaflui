'use client'
import { useActionState } from 'react'
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { Button, FormErrors } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { ESTADO_VAZIO } from '../../../_lib/estado'
import { mudarQuantidade, tirarDoCarrinho } from '../actions'
import type { ItemDoCarrinho } from '../_lib/resumo'

/**
 * Uma linha do carrinho: foto, nome, preço, a quantidade (−/+ enviam o valor novo, e 1 − 1 tira o item) e "Tirar". Cada botão é
 * um envio de formulário, então funciona também sem JavaScript; o problema da linha (esgotado, saiu da loja) vem em texto.
 */
export function LinhaDoCarrinho({ slug, item }: { slug: string; item: ItemDoCarrinho }) {
  const [qtd, mudar, mudando] = useActionState(mudarQuantidade.bind(null, slug), ESTADO_VAZIO)
  const [tirar, retirar, tirando] = useActionState(tirarDoCarrinho.bind(null, slug), ESTADO_VAZIO)
  const indisponivel = item.max < 1
  return (
    <li className="af-cl-line">
      <div className="af-cl-line__media" aria-hidden="true">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta
          <img src={item.imageUrl} alt="" />
        ) : (
          <ShoppingBag size={24} />
        )}
      </div>
      <div className="af-cl-line__body">
        <p className="af-cl-line__name">{item.name}</p>
        {indisponivel ? null : <p className="af-cl-line__price">{formatMoney(item.unitCents)} cada</p>}
        {item.problema ? (
          <p role="alert" className="af-cl-line__problem">
            {item.problema}
          </p>
        ) : null}
        <div className="af-cl-line__controls">
          {indisponivel ? null : (
            <form action={mudar} className="af-cl-qty" aria-label={`Quantidade de ${item.name}`}>
              <input type="hidden" name="productId" value={item.productId} />
              <button type="submit" name="quantity" value={item.quantity - 1} className="af-cl-qty__btn" aria-label={item.quantity === 1 ? `Tirar ${item.name}` : 'Diminuir'} disabled={mudando}>
                {item.quantity === 1 ? <Trash2 size={16} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}
              </button>
              <output className="af-cl-qty__value">{item.quantity}</output>
              <button type="submit" name="quantity" value={item.quantity + 1} className="af-cl-qty__btn" aria-label="Aumentar" disabled={mudando || item.quantity >= item.max}>
                <Plus size={18} aria-hidden="true" />
              </button>
            </form>
          )}
          <form action={retirar}>
            <input type="hidden" name="productId" value={item.productId} />
            <Button type="submit" variant="ghost" size="sm" loading={tirando}>
              Tirar
            </Button>
          </form>
        </div>
        {qtd.ok ? null : <FormErrors message={qtd.message} fields={qtd.fields} />}
        {tirar.ok ? null : <FormErrors message={tirar.message} fields={tirar.fields} />}
      </div>
      {indisponivel ? null : <p className="af-cl-line__total">{formatMoney(item.totalCents)}</p>}
    </li>
  )
}
