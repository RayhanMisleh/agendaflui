import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { listServices } from '@/server/domain/catalog/services'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { Card } from '@/ui/components'
import { um } from '@/app/_lib/params'
import { PainelFrame } from '../PainelFrame'
import { ServicosPainel } from './ServicosPainel'
import type { ServicoLinha } from './ServicosPainel'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Serviços | Agenda Flui' }

export default async function ServicosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('manage_catalog')
  const arquivados = um((await searchParams).situacao) === 'arquivados'
  const [todos, painel, regras] = await Promise.all([
    listServices(ctx, { includeInactive: true, includeArchived: true }),
    getPainelContext(ctx),
    getSchedulingRules(ctx),
  ])
  const doGrupo = todos.filter((s) => s.archived === arquivados)
  const servicos: ServicoLinha[] = doGrupo.map((s, i) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    priceCents: s.priceCents,
    durationMin: s.durationMin,
    rewardPoints: s.rewardPoints,
    clubOnly: s.clubOnly,
    active: s.active,
    archived: s.archived,
    first: i === 0,
    last: i === doGrupo.length - 1,
  }))

  return (
    <PainelFrame ctx={ctx} title="Serviços">
      <Card className="af-listpanel" as="section" aria-label="Serviços">
        <ServicosPainel
          servicos={servicos}
          arquivados={arquivados}
          ctx={{ step: regras.slotStepMin, loyalty: painel.modules.loyalty, pontos: TERMS.pointsPlural, clube: TERMS.club }}
        />
      </Card>
    </PainelFrame>
  )
}
