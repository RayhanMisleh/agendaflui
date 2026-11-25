'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { Button } from '@/ui/components'
import { ClienteForm } from '../../../_lib/ClienteForm'
import { porNoCarrinho } from '../actions'
import { Quantidade } from './Quantidade'

/** Escolhe a quantidade e põe no carrinho; ao pôr, diz o que fez e leva ao carrinho. Esgotado: botão desabilitado. */
export function PorNoCarrinho({ slug, productId, max }: { slug: string; productId: string; max: number }) {
  const [quantidade, setQuantidade] = useState(1)
  if (max < 1) {
    return (
      <Button variant="secondary" size="lg" disabled>
        Esgotado
      </Button>
    )
  }
  return (
    <ClienteForm action={porNoCarrinho} slug={slug} hidden={{ productId, quantity: String(quantidade) }} submit="Pôr no carrinho" submitIcon={<ShoppingCart size={18} />}>
      {(estado) => (
        <>
          <Quantidade value={quantidade} max={max} onChange={setQuantidade} />
          {estado.ok && estado.message ? (
            <p role="status" className="af-cl-added">
              {estado.message}{' '}
              <Link href={`/${slug}/loja/carrinho`} className="af-cl-link">
                Ver carrinho
              </Link>
            </p>
          ) : null}
        </>
      )}
    </ClienteForm>
  )
}
