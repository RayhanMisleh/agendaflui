import { EmptyIllustration, LinkButton } from '@/ui/components'

/** Módulo desligado na loja (Prêmios, Loja): quem chegou pelo endereço vê o motivo e volta ao início. */
export function ModuloDesligado({ slug, what }: { slug: string; what: 'Prêmios' | 'Loja' }) {
  return (
    <section className="af-cl-state af-cl-state--inline" aria-labelledby="modulo-desligado">
      <span className="af-cl-state__art">
        <EmptyIllustration name={what === 'Loja' ? 'carrinho' : 'premios'} size={96} />
      </span>
      <h2 id="modulo-desligado" className="af-cl-state__title">
        {what} não está disponível nesta loja agora.
      </h2>
      <LinkButton href={`/${slug}`} variant="secondary" size="lg">
        Ir para o início
      </LinkButton>
    </section>
  )
}
