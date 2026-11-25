import { requireTenant } from '@/server/auth/guards'
import { Card, EmptyState, LinkButton } from '@/ui/components'
import { ShellPage } from '@/ui/shells'

/** Rota que não existe, registro removido ou módulo desligado nesta loja: a moldura do painel continua no lugar. */
export default async function PainelNaoEncontrado() {
  await requireTenant()
  return (
    <ShellPage title="Não encontrado">
      <Card>
        <EmptyState
          title="Não achamos o que você procurou"
          description="Pode ter sido removido ou estar desligado nesta loja."
          action={
            <LinkButton href="/painel" variant="primary">
              Voltar ao início
            </LinkButton>
          }
        />
      </Card>
    </ShellPage>
  )
}
