import type { Metadata } from 'next'
import Link from 'next/link'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listLoyaltyEntries } from '@/server/domain/loyalty/ledger'
import { pointsText } from '@/shared/terms'
import { LinkButton } from '@/ui/components'
import { um } from '@/app/_lib/params'
import { ClienteFrame, modulosDaLoja } from '../../_lib/ClienteFrame'
import { ModuloDesligado } from '../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../_lib/loja'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Extrato')
}

const TIPO = { EARN: 'Atendimento', EARN_REVERSAL: 'Atendimento desfeito', REDEEM: 'Resgate', REDEEM_REVERSAL: 'Resgate cancelado', ADJUST: 'Ajuste' } as const

/** Extrato de pontos do cliente: do mais novo ao mais antigo, com "Carregar mais". */
export default async function ExtratoPage({ params, searchParams }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/premios/extrato`)
  const voltar = { href: `/${slug}/premios`, label: 'Prêmios' }
  if (!(await modulosDaLoja(visit)).loyalty) {
    return (
      <ClienteFrame visit={visit} title="Extrato" back={voltar}>
        <ModuloDesligado slug={slug} what="Prêmios" />
      </ClienteFrame>
    )
  }
  const cursor = um((await searchParams).cursor)
  let pagina
  try {
    pagina = await listLoyaltyEntries(visit.ctx, visit.customerId, cursor ? { cursor } : {})
  } catch (err) {
    // Cursor velho ou adulterado: recomeça do topo em vez de mostrar erro.
    if (!(err instanceof DomainError) || err.fields?.['cursor'] === undefined) throw err
    pagina = await listLoyaltyEntries(visit.ctx, visit.customerId)
  }
  return (
    <ClienteFrame visit={visit} title="Extrato" back={voltar}>
      {pagina.items.length === 0 ? (
        <p className="af-cl-muted">Ainda não há movimento de pontos. Os pontos entram quando você conclui um atendimento.</p>
      ) : (
        <ul className="af-cl-ledger">
          {pagina.items.map((e) => (
            <li key={e.id} className="af-cl-ledger__row">
              <div className="af-cl-ledger__main">
                <p className="af-cl-ledger__kind">{TIPO[e.kind]}</p>
                {e.reason && e.reason !== TIPO[e.kind] ? <p className="af-cl-ledger__reason">{e.reason}</p> : null}
                <p className="af-cl-ledger__date">{e.createdLabel}</p>
              </div>
              <p className={e.points < 0 ? 'af-cl-ledger__points is-minus' : 'af-cl-ledger__points'}>
                <span aria-hidden="true">{e.points > 0 ? '+' : '−'}</span>
                <span className="af-sr">{e.points > 0 ? 'Mais ' : 'Menos '}</span>
                {pointsText(Math.abs(e.points))}
              </p>
            </li>
          ))}
        </ul>
      )}
      {cursor && pagina.items.length > 0 ? (
        <LinkButton href={`/${slug}/premios/extrato`} variant="ghost">
          Voltar ao começo
        </LinkButton>
      ) : null}
      {pagina.nextCursor ? (
        <Link href={`/${slug}/premios/extrato?cursor=${encodeURIComponent(pagina.nextCursor)}`} className="af-button af-button--secondary af-button--md" prefetch={false}>
          <span className="af-button__label">Carregar mais</span>
        </Link>
      ) : null}
    </ClienteFrame>
  )
}
