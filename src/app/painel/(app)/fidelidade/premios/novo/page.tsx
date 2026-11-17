import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../../PainelFrame'
import { requirePainelModule } from '../../../_lib/modulo'
import { PremioForm } from '../../FidelidadePainel'

export const metadata: Metadata = { title: 'Novo prêmio | AgendaFlui' }

export default async function NovoPremioPage() {
  const ctx = await requireTenant('manage_loyalty')
  await requirePainelModule(ctx, 'loyalty')
  const { terms } = await getPainelContext(ctx)
  return (
    <PainelFrame
      ctx={ctx}
      title="Novo prêmio"
      actions={
        <LinkButton href="/fidelidade" variant="ghost">
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
    </PainelFrame>
  )
}
