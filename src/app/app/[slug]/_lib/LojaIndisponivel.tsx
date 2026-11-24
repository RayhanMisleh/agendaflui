import { EmptyIllustration, LinkButton } from '@/ui/components'

/** Loja suspensa, inexistente ou com nome de rota do sistema: nunca um erro cru. */
export function LojaIndisponivel() {
  return (
    <main className="af-cl-state" data-testid="loja-indisponivel">
      <span className="af-cl-state__art">
        <EmptyIllustration name="loja-fechada" size={112} />
      </span>
      <h1 className="af-cl-state__title">Loja indisponível</h1>
      <p className="af-cl-state__text">Esta loja não está disponível agora. Confira o link com a loja.</p>
      <LinkButton href="/entrar" variant="secondary" size="lg">
        Ir para a entrada
      </LinkButton>
    </main>
  )
}
