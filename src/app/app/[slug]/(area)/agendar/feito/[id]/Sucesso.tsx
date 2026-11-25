import { CalendarPlus, House, ListChecks } from 'lucide-react'
import type { AppointmentStatus } from '@/server/db/generated/client'
import { Bubbles, Celebration, LinkButton } from '@/ui/components'
import { formatMoney } from '@/ui/format'

export type DadosDoSucesso = {
  id: string
  status: AppointmentStatus
  remarcado: boolean
  /** "sábado, 29 de novembro" */
  dia: string
  hora: string
  pet: string | null
  servicos: string[]
  profissional: string
  totalCents: number
}

export function tituloDoSucesso(d: Pick<DadosDoSucesso, 'status' | 'remarcado'>): string {
  if (d.remarcado) return 'Horário remarcado'
  return d.status === 'PENDING' ? 'Pedido de horário enviado' : 'Horário marcado'
}

/** O momento de celebração depois de marcar: dia e hora em destaque, o resumo e os próximos passos. */
export function Sucesso({ slug, d }: { slug: string; d: DadosDoSucesso }) {
  return (
    <section className="af-cl-done" aria-labelledby="sucesso-titulo">
      <div className="af-cl-done__hero">
        <Bubbles on="brand" />
        <Celebration play />
        <h2 id="sucesso-titulo" className="af-cl-done__title">
          {tituloDoSucesso(d)}
        </h2>
        {d.status === 'PENDING' ? <p className="af-cl-done__sub">A loja confirma e avisa você por e-mail.</p> : null}
        <p className="af-cl-done__when">
          <span>{d.dia}</span>
          <span className="af-cl-done__time af-tabular">{d.hora}</span>
        </p>
      </div>
      <dl className="af-cl-quiz__summary">
        {d.pet ? (
          <div className="af-cl-quiz__row">
            <dt>Pet</dt>
            <dd>{d.pet}</dd>
          </div>
        ) : null}
        <div className="af-cl-quiz__row">
          <dt>Serviços</dt>
          <dd>{d.servicos.join(', ')}</dd>
        </div>
        <div className="af-cl-quiz__row">
          <dt>Com</dt>
          <dd>{d.profissional}</dd>
        </div>
        <div className="af-cl-quiz__row">
          <dt>Total</dt>
          <dd className="af-tabular">
            <strong>{formatMoney(d.totalCents)}</strong>
          </dd>
        </div>
      </dl>
      <div className="af-cl-done__actions">
        <a href={`/${slug}/horarios/${d.id}/agenda.ics`} download className="af-button af-button--primary af-button--lg">
          <span className="af-button__label">
            <span className="af-button__icon" aria-hidden="true">
              <CalendarPlus size={18} />
            </span>
            Adicionar à minha agenda
          </span>
        </a>
        <LinkButton href={`/${slug}/horarios`} variant="secondary" size="lg" icon={<ListChecks size={18} />}>
          Ver meus horários
        </LinkButton>
        <LinkButton href={`/${slug}`} variant="ghost" size="lg" icon={<House size={18} />}>
          Voltar ao início
        </LinkButton>
      </div>
    </section>
  )
}
