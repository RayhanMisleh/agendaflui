import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../PainelFrame'
import { NovoProfissionalForm } from '../FichaForms'

export const metadata: Metadata = { title: 'Nova ficha | Agenda Flui' }

export default async function NovoProfissionalPage() {
  const ctx = await requireTenant('manage_team')
  const painel = await getPainelContext(ctx)
  const { terms } = painel
  return (
    <PainelFrame
      ctx={ctx}
      title={`Adicionar ${terms.professionalSingular.toLowerCase()}`}
      actions={
        <LinkButton href="/painel/equipe" variant="ghost">
          Voltar para {terms.professionalPlural.toLowerCase()}
        </LinkButton>
      }
    >
      <Card as="section" aria-label="Cadastro" className="af-profile af-profile--narrow">
        <NovoProfissionalForm singular={terms.professionalSingular} />
      </Card>
    </PainelFrame>
  )
}
