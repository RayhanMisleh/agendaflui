import type { Metadata } from 'next'
import Link from 'next/link'
import { um } from '@/app/_lib/params'
import { requireCustomer } from '@/server/auth/guards'
import { todayIn } from '@/server/time'
import { formatMonthYear } from '@/shared/local-date-pt'
import { NavTabs } from '@/ui/components'
import { ClienteFrame } from '../_lib/ClienteFrame'
import { metadataDaLoja } from '../_lib/loja'
import { HorarioLinha } from './_lib/HorarioLinha'
import { HorariosVazios } from './_lib/HorariosVazios'
import { listarHorarios } from './_lib/listar'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Meus horários')
}

/** Meus horários: próximos e anteriores do próprio cliente, por páginas ("Carregar mais"), anteriores agrupados por mês. */
export default async function HorariosPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const anteriores = um(sp.ver) === 'anteriores'
  const visit = await requireCustomer(slug, `/${slug}/horarios`)
  const depois = um(sp.depois)
  const { items, nextCursor } = await listarHorarios(visit, { anteriores, ...(depois ? { depois } : {}) })
  const today = todayIn(visit.ctx.timeZone, visit.ctx.clock())
  const grupos: { mes: string; itens: typeof items }[] = []
  if (anteriores) {
    for (const a of items) {
      const mes = formatMonthYear(a.local.date)
      const ultimo = grupos[grupos.length - 1]
      if (ultimo && ultimo.mes === mes) ultimo.itens.push(a)
      else grupos.push({ mes, itens: [a] })
    }
  }
  return (
    <ClienteFrame visit={visit} title="Meus horários">
      {um(sp.cancelado) === '1' ? (
        <p role="status" className="af-cl-notice af-cl-notice--ok">
          Horário cancelado.
        </p>
      ) : null}
      <NavTabs
        label="Meus horários"
        items={[
          { id: 'proximos', label: 'Próximos', href: `/${slug}/horarios`, active: !anteriores },
          { id: 'anteriores', label: 'Anteriores', href: `/${slug}/horarios?ver=anteriores`, active: anteriores },
        ]}
      />
      {items.length === 0 && !depois ? (
        <HorariosVazios slug={slug} anteriores={anteriores} />
      ) : anteriores ? (
        grupos.map((g) => (
          <section key={g.mes} aria-label={g.mes}>
            <h2 className="af-cl-section af-cl-appts__month">{g.mes}</h2>
            <ul className="af-cl-appts">
              {g.itens.map((a) => (
                <HorarioLinha key={a.id} slug={slug} a={a} today={today} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <ul className="af-cl-appts">
          {items.map((a) => (
            <HorarioLinha key={a.id} slug={slug} a={a} today={today} />
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Link href={`/${slug}/horarios?${anteriores ? 'ver=anteriores&' : ''}depois=${encodeURIComponent(nextCursor)}`} className="af-button af-button--secondary af-button--lg af-cl-appts__more">
          <span className="af-button__label">Carregar mais</span>
        </Link>
      ) : null}
    </ClienteFrame>
  )
}
