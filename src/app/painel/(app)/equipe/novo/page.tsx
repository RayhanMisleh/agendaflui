import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { listServices } from '@/server/domain/catalog/services'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../PainelFrame'
import { NovoProfissionalForm } from '../FichaForms'

export const metadata: Metadata = { title: 'Nova ficha | Agenda Flui' }

export default async function NovoProfissionalPage() {
  const ctx = await requireTenant('manage_team')
  const [painel, servicos] = await Promise.all([getPainelContext(ctx), listServices(ctx, { includeInactive: true })])
  const { terms } = painel
  return (
    <PainelFrame
      ctx={ctx}
      title={`Adicionar ${terms.professionalSingular.toLowerCase()}`}
      actions={
        <LinkButton href="/equipe" variant="ghost">
          Voltar para {terms.professionalPlural.toLowerCase()}
        </LinkButton>
      }
    >
      <Card as="section" aria-label="Dados da ficha" className="af-profile af-profile--narrow">
        <NovoProfissionalForm servicos={servicos.map((s) => ({ id: s.id, name: s.name, does: true }))} singular={terms.professionalSingular} />
      </Card>
    </PainelFrame>
  )
}
