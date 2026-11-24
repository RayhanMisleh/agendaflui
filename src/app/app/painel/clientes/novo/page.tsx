import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, LinkButton } from '@/ui/components'
import { PainelFrame } from '../../PainelFrame'
import { ClienteForm } from '../ClienteForm'

export const metadata: Metadata = { title: 'Novo cadastro | Agenda Flui' }

export default async function NovoClientePage() {
  const ctx = await requireTenant('manage_clients')
  const painel = await getPainelContext(ctx)
  const { terms } = painel
  return (
    <PainelFrame
      ctx={ctx}
      title={`Adicionar ${terms.customerSingular.toLowerCase()}`}
      actions={
        <LinkButton href="/painel/clientes" variant="ghost">
          Voltar para {terms.customerPlural.toLowerCase()}
        </LinkButton>
      }
    >
      <Card as="section" aria-label="Dados do cadastro" className="af-profile af-profile--narrow">
        <ClienteForm cliente={null} clube={painel.modules.loyalty ? painel.terms.club : null} singular={terms.customerSingular} />
      </Card>
    </PainelFrame>
  )
}
