import type { Metadata } from 'next'
import { requireCustomer } from '@/server/auth/guards'
import { getCustomerLoyalty } from '@/server/domain/loyalty/ledger'
import { listPrizes } from '@/server/domain/loyalty/prizes'
import { getRanking } from '@/server/domain/loyalty/ranking'
import { listRedemptions } from '@/server/domain/loyalty/redemptions'
import { EmptyIllustration } from '@/ui/components'
import { ClienteFrame, modulosDaLoja } from '../_lib/ClienteFrame'
import { ModuloDesligado } from '../_lib/ModuloDesligado'
import { metadataDaLoja } from '../_lib/loja'
import { PremioCartao } from './_lib/PremioCartao'
import { Ranking } from './_lib/Ranking'
import { Resgates } from './_lib/Resgates'
import { Saldo } from './_lib/Saldo'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Prêmios')
}

/** Prêmios: o saldo, os resgates esperando retirada, a vitrine de prêmios e (se a loja ligou) o ranking do mês. */
export default async function PremiosPage({ params }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/premios`)
  if (!(await modulosDaLoja(visit)).loyalty) {
    return (
      <ClienteFrame visit={visit} title="Prêmios">
        <ModuloDesligado slug={slug} what="Prêmios" />
      </ClienteFrame>
    )
  }
  const { ctx, customerId } = visit
  const [saldo, premios, pendentes, ranking] = await Promise.all([
    getCustomerLoyalty(ctx, customerId),
    listPrizes(ctx),
    listRedemptions(ctx, { status: 'PENDING' }),
    getRanking(ctx),
  ])
  return (
    <ClienteFrame visit={visit} title="Prêmios">
      <Saldo slug={slug} balance={saldo.balance} clubMember={saldo.clubMember} />
      <Resgates slug={slug} resgates={pendentes.items.map((r) => ({ id: r.id, prizeName: r.prize.name, costPoints: r.costPoints, createdLabel: r.createdLabel }))} />
      <section aria-labelledby="premios-titulo">
        <h2 id="premios-titulo" className="af-cl-section">
          Prêmios
        </h2>
        {premios.length === 0 ? (
          <div className="af-cl-state af-cl-state--inline">
            <span className="af-cl-state__art">
              <EmptyIllustration name="premios" size={96} />
            </span>
            <p className="af-cl-state__title">Nenhum prêmio por enquanto</p>
            <p className="af-cl-state__text">Continue juntando pontos: a loja vai avisar quando houver novidade.</p>
          </div>
        ) : (
          <ul className="af-cl-prizes">
            {premios.map((p) => (
              <PremioCartao key={p.id} slug={slug} balance={saldo.balance} prize={{ id: p.id, name: p.name, description: p.description, imageUrl: p.imageUrl, costPoints: p.costPoints, stock: p.stock }} />
            ))}
          </ul>
        )}
      </section>
      {ranking.enabled ? <Ranking entries={ranking.entries} /> : null}
    </ClienteFrame>
  )
}
