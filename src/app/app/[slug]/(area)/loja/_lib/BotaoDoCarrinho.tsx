import { ShoppingCart } from 'lucide-react'
import { LinkButton } from '@/ui/components'

/** O botão do carrinho com a contagem, no cabeçalho das telas da Loja. */
export function BotaoDoCarrinho({ slug, unidades }: { slug: string; unidades: number }) {
  return (
    <LinkButton href={`/${slug}/loja/carrinho`} variant="secondary" size="sm" icon={<ShoppingCart size={18} />}>
      {unidades > 0 ? `Carrinho (${unidades})` : 'Carrinho'}
    </LinkButton>
  )
}
