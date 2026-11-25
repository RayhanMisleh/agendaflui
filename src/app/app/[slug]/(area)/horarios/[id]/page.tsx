import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CalendarPlus, RefreshCw } from 'lucide-react'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getAppointment } from '@/server/domain/scheduling/appointments'
import { getStorefront } from '@/server/domain/storefront/storefront'
import { AppointmentStatusBadge, LinkButton } from '@/ui/components'
import { formatLongDate, formatMoney } from '@/ui/format'
import { ClientePagina } from '@/ui/shells'
import { metadataDaLoja } from '../../../_lib/loja'
import { CancelarHorario } from '../_lib/CancelarHorario'

type Props = { params: Promise<{ slug: string; id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Horário')
}

/** O horário do próprio cliente: detalhes, total, recado e, dentro do prazo, remarcar e cancelar. O de outro cliente é 404. */
export default async function HorarioPage({ params }: Props) {
  const { slug, id } = await params
  const visit = await requireCustomer(slug, `/${slug}/horarios/${id}`)
  const a = await getAppointment(visit.ctx, id).catch((err: unknown) => {
    if (err instanceof DomainError && (err.code === 'not_found' || err.code === 'forbidden')) return notFound()
    throw err
  })
  const aberto = a.status === 'PENDING' || a.status === 'CONFIRMED'
  const futuro = a.endsAt.getTime() > visit.ctx.clock().getTime()
  const telefone = (await getStorefront(visit.ctx)).phone
  return (
    <ClientePagina title={a.pet ? `Horário de ${a.pet.name}` : 'Horário'} back={{ href: `/${slug}/horarios`, label: 'Meus horários' }}>
      <div className="af-cl-pet">
        <div className="af-cl-detail__when">
          <p className="af-cl-detail__day">{formatLongDate(a.local.date)}</p>
          <p className="af-cl-detail__time af-tabular">
            {a.local.start} às {a.local.end}
          </p>
          <AppointmentStatusBadge status={a.status} />
        </div>
        <dl className="af-cl-quiz__summary">
          {a.pet ? (
            <div className="af-cl-quiz__row">
              <dt>Pet</dt>
              <dd>{a.pet.name}</dd>
            </div>
          ) : null}
          <div className="af-cl-quiz__row">
            <dt>Serviços</dt>
            <dd>
              {a.items.map((i) => (
                <span key={i.serviceId} className="af-cl-flow__line">
                  <span>{i.name}</span>
                  <span className="af-tabular">{formatMoney(i.priceCents)}</span>
                </span>
              ))}
            </dd>
          </div>
          <div className="af-cl-quiz__row">
            <dt>Com</dt>
            <dd>{a.professional.name}</dd>
          </div>
          <div className="af-cl-quiz__row">
            <dt>Total</dt>
            <dd className="af-tabular">
              <strong>{formatMoney(a.totalCents)}</strong>
            </dd>
          </div>
          {a.customerNote ? (
            <div className="af-cl-quiz__row">
              <dt>Recado</dt>
              <dd>{a.customerNote}</dd>
            </div>
          ) : null}
        </dl>
        {aberto && futuro ? (
          a.change.allowed ? (
            <div className="af-cl-detail__actions">
              <LinkButton href={`/${slug}/horarios/${a.id}/remarcar`} variant="primary" size="lg" icon={<RefreshCw size={18} />}>
                Remarcar
              </LinkButton>
              <a href={`/${slug}/horarios/${a.id}/agenda.ics`} download className="af-button af-button--secondary af-button--md">
                <span className="af-button__label">
                  <span className="af-button__icon" aria-hidden="true">
                    <CalendarPlus size={16} />
                  </span>
                  Adicionar à minha agenda
                </span>
              </a>
              <CancelarHorario slug={slug} appointmentId={a.id} petName={a.pet?.name ?? null} variant="ghost" />
            </div>
          ) : (
            <>
              <p role="note" className="af-cl-notice">
                O prazo para mudar por aqui terminou{a.change.untilLabel ? ` em ${a.change.untilLabel}` : ''}. Fale com a loja
                {telefone ? (
                  <>
                    : <a href={telefone.href}>{telefone.label}</a>
                  </>
                ) : null}
                .
              </p>
              <a href={`/${slug}/horarios/${a.id}/agenda.ics`} download className="af-button af-button--secondary af-button--md">
                <span className="af-button__label">
                  <span className="af-button__icon" aria-hidden="true">
                    <CalendarPlus size={16} />
                  </span>
                  Adicionar à minha agenda
                </span>
              </a>
            </>
          )
        ) : null}
      </div>
    </ClientePagina>
  )
}
