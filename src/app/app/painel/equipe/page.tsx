import type { Metadata } from 'next'
import { UserPlus } from 'lucide-react'
import { requireTenant } from '@/server/auth/guards'
import { roleLabel } from '@/server/auth/role-labels'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { listTeamOverview } from '@/server/domain/team/sheet'
import { Card, EmptyState, LinkButton } from '@/ui/components'
import { ShellPage } from '@/ui/shells'
import { EquipeTabela } from './EquipeTabela'
import type { EquipeLinha } from './EquipeTabela'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Equipe | Agenda Flui' }

export default async function EquipePage() {
  const ctx = await requireTenant('manage_team')
  const [, equipe] = await Promise.all([getPainelContext(ctx), listTeamOverview(ctx)])
  const terms = TERMS
  const novo = `Adicionar ${terms.professionalSingular.toLowerCase()}`
  const linhas = equipe.map((r): EquipeLinha => ({
    id: r.professional.id,
    name: r.professional.name,
    avatarUrl: r.professional.avatarUrl,
    servicos: r.serviceNames,
    ativo: r.professional.active === true,
    papel: r.access ? roleLabel(r.access.role) : null,
    acesso: r.access?.status ?? 'none',
  }))

  return (
    <ShellPage
      title={terms.professionalPlural}
      actions={
        <LinkButton href="/painel/equipe/novo" variant="primary" icon={<UserPlus size={18} />}>
          {novo}
        </LinkButton>
      }
    >
      <Card className="af-listpanel" as="section" aria-label={terms.professionalPlural}>
        <EquipeTabela
          linhas={linhas}
          vazio={
            <EmptyState
              title={`Cadastre o primeiro ${terms.professionalSingular.toLowerCase()}`}
              description="Cada ficha tem foto, serviços, expediente e, se a pessoa for usar o painel, um acesso próprio."
              action={
                <LinkButton href="/painel/equipe/novo" variant="primary" icon={<UserPlus size={18} />}>
                  {novo}
                </LinkButton>
              }
            />
          }
        />
      </Card>
    </ShellPage>
  )
}
