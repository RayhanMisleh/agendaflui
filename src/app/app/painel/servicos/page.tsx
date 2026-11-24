import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { fromPrice } from '@/server/domain/catalog/pricing'
import { listServices } from '@/server/domain/catalog/services'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { Card } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { um } from '@/app/_lib/params'
import { PainelFrame } from '../PainelFrame'
import { ServicosPainel } from './ServicosPainel'
import type { ServicoLinha } from './ServicosPainel'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Serviços | Agenda Flui' }

/** "4 portes", "3 portes e gato": o que a tabela de preço por porte cobre (gato só com a loja atendendo gatos). */
function linhasDe(prices: { variant: string }[], servesCats: boolean): string {
  const caes = prices.filter((p) => p.variant !== 'CAT').length
  const gato = servesCats && prices.some((p) => p.variant === 'CAT')
  const texto = caes === 0 ? '' : `${caes} ${caes === 1 ? 'porte' : 'portes'}`
  return gato ? (texto === '' ? 'Só gato' : `${texto} e gato`) : texto
}

export default async function ServicosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('manage_catalog')
  const arquivados = um((await searchParams).situacao) === 'arquivados'
  const [todos, painel, regras] = await Promise.all([
    listServices(ctx, { includeInactive: true, includeArchived: true }),
    getPainelContext(ctx),
    getSchedulingRules(ctx),
  ])
  const doGrupo = todos.filter((s) => s.archived === arquivados)
  const servesCats = painel.niche?.servesCats ?? false
  const servicos: ServicoLinha[] = doGrupo.map((s, i) => {
    const porPorte = s.pricingMode === 'BY_VARIANT'
    const aPartirDe = porPorte ? fromPrice(s, { servesCats }) : null
    const visiveis = s.prices.filter((p) => servesCats || p.variant !== 'CAT')
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      icon: s.icon,
      priceCents: s.priceCents,
      durationMin: s.durationMin,
      pricingMode: s.pricingMode,
      prices: s.prices,
      fromLabel: aPartirDe ? `Por porte · a partir de ${formatMoney(aPartirDe.cents)}` : null,
      linesLabel: porPorte ? linhasDe(s.prices, servesCats) || null : null,
      fromDurationMin: porPorte && visiveis.length > 0 ? Math.min(...visiveis.map((p) => p.durationMin)) : null,
      rewardPoints: s.rewardPoints,
      clubOnly: s.clubOnly,
      active: s.active,
      archived: s.archived,
      first: i === 0,
      last: i === doGrupo.length - 1,
    }
  })

  return (
    <PainelFrame ctx={ctx} title="Serviços">
      <Card className="af-listpanel" as="section" aria-label="Serviços">
        <ServicosPainel
          servicos={servicos}
          arquivados={arquivados}
          ctx={{ step: regras.slotStepMin, loyalty: painel.modules.loyalty, pontos: TERMS.pointsPlural, clube: TERMS.club, niche: painel.niche ? { servesCats: painel.niche.servesCats } : null }}
        />
      </Card>
    </PainelFrame>
  )
}
