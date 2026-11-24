import { LinkButton } from '@/ui/components'
import { EntryScreen } from '@/ui/shells'
import { MARCA_ENTRADA, TEMA_ENTRADA } from '@/app/app/_lib/marca'

/** Loja suspensa, inexistente ou com nome de rota do sistema: nunca um erro cru. */
export function LojaIndisponivel() {
  return (
    <EntryScreen
      theme={TEMA_ENTRADA}
      brand={MARCA_ENTRADA}
      headline="A agenda que flui."
      title="Loja indisponível"
      message="Esta loja não está disponível agora. Confira o link com a loja."
      testId="loja-indisponivel"
    >
      <div className="af-entry__actions">
        <LinkButton href="/entrar" variant="secondary" size="lg">
          Ir para a entrada
        </LinkButton>
      </div>
    </EntryScreen>
  )
}
