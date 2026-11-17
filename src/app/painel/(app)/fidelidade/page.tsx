import type { Metadata } from 'next'
import { requireTenant } from '@/server/auth/guards'
import { listCustomers } from '@/server/domain/customers/customers'
import { listPrizes } from '@/server/domain/loyalty/prizes'
import { listRedemptions } from '@/server/domain/loyalty/redemptions'
import { getLoyaltySettings } from '@/server/domain/loyalty/settings'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, NavTabs, Pagination } from '@/ui/components'
import { um } from '@/app/_lib/params'
import { PainelFrame } from '../PainelFrame'
import { requirePainelModule } from '../_lib/modulo'
import { ClubeLista, PremiosLista, RankingForm, ResgatesLista } from './FidelidadePainel'
import type { TermosFidelidade } from './FidelidadePainel'

export const metadata: Metadata = { title: 'Fidelidade | AgendaFlui' }

const ABAS = [
  { id: 'premios', label: 'Prêmios' },
  { id: 'resgates', label: 'Resgates' },
  { id: 'clube', label: 'Clube' },
  { id: 'ajustes', label: 'Ajustes da conta' },
] as const
type Aba = (typeof ABAS)[number]['id']

const SITUACOES = [
  { id: '', label: 'Todos', status: undefined },
  { id: 'pendentes', label: 'Pendentes', status: 'PENDING' },
  { id: 'entregues', label: 'Entregues', status: 'DELIVERED' },
  { id: 'cancelados', label: 'Cancelados', status: 'CANCELED' },
] as const

export default async function FidelidadePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('manage_loyalty')
  await requirePainelModule(ctx, 'loyalty')
  const q = await searchParams
  const aba: Aba = ABAS.find((a) => a.id === um(q.aba))?.id ?? 'premios'
  const cursor = um(q.cursor) || null
  const painel = await getPainelContext(ctx)
  const { terms } = painel
  const termos: TermosFidelidade = { ponto: terms.pointsSingular, pontos: terms.pointsPlural, clube: terms.club, cliente: terms.customerPlural }
  const abas = ABAS.map((a) => ({ id: a.id, label: a.id === 'clube' ? terms.club : a.label, href: a.id === 'premios' ? '/fidelidade' : `/fidelidade?aba=${a.id}`, active: aba === a.id }))

  let corpo
  if (aba === 'premios') {
    const lista = await listPrizes(ctx, { includeInactive: true })
    corpo = (
      <PremiosLista
        termos={termos}
        premios={lista.map((p, i) => ({ id: p.id, name: p.name, description: p.description, imageUrl: p.imageUrl, costPoints: p.costPoints, stock: p.stock, active: p.active, first: i === 0, last: i === lista.length - 1 }))}
      />
    )
  } else if (aba === 'resgates') {
    const situacao = SITUACOES.find((s) => s.id === um(q.situacao)) ?? SITUACOES[0]
    const r = await listRedemptions(ctx, { ...(situacao.status ? { status: situacao.status } : {}), ...(cursor ? { cursor } : {}), limit: 30 })
    corpo = (
      <>
        <NavTabs
          label="Situação dos resgates"
          items={SITUACOES.map((s) => ({ id: s.id || 'todos', label: s.label, href: s.id ? `/fidelidade?aba=resgates&situacao=${s.id}` : '/fidelidade?aba=resgates', active: s.id === situacao.id }))}
        />
        <ResgatesLista
          termos={termos}
          resgates={r.items.map((x) => ({
            id: x.id,
            status: x.status,
            prizeName: x.prize.name,
            costPoints: x.costPoints,
            customerId: x.customer.id,
            customerName: x.customer.name,
            createdLabel: x.createdLabel,
            deliveredLabel: x.deliveredLabel,
            canceledLabel: x.canceledLabel,
            cancelReason: x.cancelReason,
          }))}
        />
        <Pagination basePath="/fidelidade" params={{ aba: 'resgates', situacao: situacao.id }} cursor={cursor} nextCursor={r.nextCursor} />
      </>
    )
  } else if (aba === 'clube') {
    const m = await listCustomers(ctx, { clubOnly: true, ...(cursor ? { cursor } : {}), limit: 30 })
    corpo = (
      <>
        <ClubeLista termos={termos} membros={m.items.map((c) => ({ id: c.id, name: c.name, phoneLabel: c.phoneLabel }))} />
        <Pagination basePath="/fidelidade" params={{ aba: 'clube' }} cursor={cursor} nextCursor={m.nextCursor} />
      </>
    )
  } else {
    const ajustes = await getLoyaltySettings(ctx)
    corpo = (
      <>
        <h2 className="af-section__title">Ranking do mês</h2>
        <RankingForm version={ajustes.version} ligado={ajustes.rankingEnabled} termos={termos} />
      </>
    )
  }

  return (
    <PainelFrame ctx={ctx} title="Fidelidade">
      <Card className="af-listpanel" as="section" aria-label="Fidelidade">
        <NavTabs label="Seções da fidelidade" items={abas} />
        {corpo}
      </Card>
    </PainelFrame>
  )
}
