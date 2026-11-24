import { CalendarPlus, RefreshCw } from 'lucide-react'
import type { AppointmentView } from '@/server/domain/scheduling/appointments'
import type { Storefront } from '@/server/domain/storefront/storefront'
import { Card, EmptyIllustration, LinkButton } from '@/ui/components'
import { relativeDayLabel } from '@/ui/format'
import { CancelarHorario } from '../horarios/_lib/CancelarHorario'

/**
 * O destaque do Início: o próximo horário do cliente, com o pet em letras grandes, o dia e a hora, e o que fazer (remarcar
 * ou cancelar dentro do prazo; depois dele, o prazo e o telefone da loja). Sem horário, convida a agendar.
 */
export function HeroiProximo({
  slug,
  next,
  today,
  storefront,
}: {
  slug: string
  next: AppointmentView | null
  today: string
  storefront: Pick<Storefront, 'phone'>
}) {
  if (!next) {
    return (
      <Card variant="block" bubbles className="af-cl-hero af-cl-hero--empty">
        <span className="af-cl-hero__art">
          <EmptyIllustration name="horarios" size={72} />
        </span>
        <h2 className="af-cl-hero__empty">Nenhum horário marcado</h2>
        <LinkButton href={`/${slug}/agendar`} variant="secondary" size="lg" icon={<CalendarPlus size={18} />}>
          Agendar
        </LinkButton>
      </Card>
    )
  }
  const quem = next.pet?.name ?? next.items.map((i) => i.name).join(', ')
  return (
    <Card variant="block" bubbles className="af-cl-hero">
      <h2 className="af-cl-hero__pet">{quem}</h2>
      <p className="af-cl-hero__when">
        <span>{relativeDayLabel(next.local.date, today)}</span>
        <span className="af-cl-hero__time af-tabular">{next.local.start}</span>
      </p>
      <p className="af-cl-hero__what">
        {next.items.map((i) => i.name).join(', ')} · com {next.professional.name}
      </p>
      {next.status === 'PENDING' ? <p className="af-cl-hero__pending">Aguardando a loja confirmar</p> : null}
      {next.change.allowed ? (
        <div className="af-cl-hero__actions">
          <LinkButton href={`/${slug}/horarios/${next.id}/remarcar`} variant="secondary" icon={<RefreshCw size={16} />}>
            Remarcar
          </LinkButton>
          <CancelarHorario slug={slug} appointmentId={next.id} petName={next.pet?.name ?? null} />
        </div>
      ) : (
        <p className="af-cl-hero__deadline" role="note">
          O prazo para mudar por aqui terminou{next.change.untilLabel ? ` em ${next.change.untilLabel}` : ''}.
          {storefront.phone ? (
            <>
              {' '}
              Fale com a loja: <a href={storefront.phone.href}>{storefront.phone.label}</a>.
            </>
          ) : null}
        </p>
      )}
    </Card>
  )
}
