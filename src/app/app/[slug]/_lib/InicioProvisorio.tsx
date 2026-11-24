import Link from 'next/link'
import { CalendarPlus, Gift } from 'lucide-react'
import type { CustomerVisit } from '@/server/auth/customer-access'
import { getCustomerHome } from '@/server/domain/scheduling/customer-home'
import { pointsText } from '@/shared/terms'
import { Card, LinkButton } from '@/ui/components'
import { formatLocalDate } from '@/ui/format'

/**
 * Início do cliente enquanto a tela completa (pets, banners, "Agendar de novo" com o pet) não chega: a saudação, o próximo
 * horário (sempre o do próprio cliente), a sugestão de repetir e os pontos. Troca-se por inteiro na tela do Início.
 */
export async function InicioProvisorio({ visit }: { visit: CustomerVisit }) {
  const home = await getCustomerHome(visit.ctx)
  const slug = visit.store.slug
  return (
    <div className="af-cl-home">
      <h2 className="af-cl-greeting">Oi, {home.firstName}</h2>
      {home.next ? (
        <Card variant="block" bubbles className="af-cl-next">
          <p className="af-cl-next__when">
            {formatLocalDate(home.next.local.date)} às <span className="af-tabular">{home.next.local.start}</span>
          </p>
          <p className="af-cl-next__what">
            {home.next.items.map((i) => i.name).join(', ')} · com {home.next.professional.name}
          </p>
          <div className="af-cl-next__actions">
            <LinkButton href={`/${slug}/horarios`} variant="secondary">
              Ver horário
            </LinkButton>
          </div>
        </Card>
      ) : (
        <Card className="af-cl-empty">
          <p className="af-cl-empty__title">Nenhum horário marcado</p>
          <LinkButton href={`/${slug}/agendar`} variant="primary" icon={<CalendarPlus size={18} />}>
            Agendar
          </LinkButton>
        </Card>
      )}
      {home.rebook ? (
        <Link href={`/${slug}/agendar${home.rebook.query}`} className="af-cl-rebook">
          <span className="af-cl-rebook__label">Agendar de novo</span>
          <span className="af-cl-rebook__what">
            {home.rebook.serviceNames.join(', ')}
            {home.rebook.professionalName ? ` com ${home.rebook.professionalName}` : ''}
          </span>
        </Link>
      ) : null}
      {home.points !== null ? (
        <Link href={`/${slug}/premios`} className="af-cl-rebook">
          <span className="af-cl-rebook__label">
            <Gift size={16} aria-hidden="true" /> {pointsText(home.points)}
          </span>
          <span className="af-cl-rebook__what">Ver prêmios</span>
        </Link>
      ) : null}
    </div>
  )
}
