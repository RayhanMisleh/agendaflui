'use client'
import { useParams } from 'next/navigation'
import { LinkButton } from '@/ui/components'

/** Endereço que não existe dentro da loja (ou dado que não é do cliente): a mesma resposta para os dois casos. */
export default function LojaNotFound() {
  const { slug } = useParams<{ slug: string }>()
  return (
    <main className="af-cl-state">
      <h1 className="af-cl-state__title">Não achamos o que você procurava.</h1>
      <p className="af-cl-state__text">O endereço pode estar errado ou já não existir.</p>
      <LinkButton href={`/${slug}`} variant="primary" size="lg">
        Ir para o início
      </LinkButton>
    </main>
  )
}
