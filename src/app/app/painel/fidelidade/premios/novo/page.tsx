import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, LinkButton } from '@/ui/components'
import { ShellPage } from '@/ui/shells'
import { requirePainelModule } from '../../../_lib/modulo'
import { PremioForm } from '../../FidelidadePainel'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Novo prêmio | Agenda Flui' }

export default async function NovoPremioPage() {
  const ctx = await requireTenant('manage_loyalty')
  await requirePainelModule(ctx, 'loyalty')
  await getPainelContext(ctx)
  const terms = TERMS
  return (
    <ShellPage
      title="Novo prêmio"
      actions={
        <LinkButton href="/painel/fidelidade" variant="ghost">
          Voltar para a fidelidade
        </LinkButton>
      }
    >
      <Card as="section" aria-labelledby="premio-novo" className="af-profile af-profile--narrow">
        <h2 id="premio-novo" className="af-section__title">
          Dados do prêmio
        </h2>
        <p className="af-section__help">Depois de criar, você envia a imagem do prêmio.</p>
        <PremioForm premio={null} termos={{ ponto: terms.pointsSingular, pontos: terms.pointsPlural, clube: terms.club, cliente: terms.customerPlural }} />
      </Card>
    </ShellPage>
  )
}
