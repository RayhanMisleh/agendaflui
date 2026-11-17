import type { Metadata } from 'next'
import { CalendarPlus, CalendarX2 } from 'lucide-react'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import type { AppointmentView } from '@/server/domain/scheduling/appointment-view'
import { getHomeOverview } from '@/server/domain/scheduling/home'
import { addDays } from '@/server/time'
import { Card, EmptyHint, EmptyState, LinkButton, PhoneLink, StatNumber, StatusBadge, TimeChip } from '@/ui/components'
import { formatDuration, shortDate, weekdayName } from '@/ui/format'
import { PainelFrame } from './PainelFrame'

export const metadata: Metadata = { title: 'Início | AgendaFlui' }

const ATENDIMENTO = (n: number) => `${n} ${n === 1 ? 'atendimento' : 'atendimentos'}`

/** O que o atendimento leva: serviços, duração e, para quem vê todas as agendas, o profissional. */
function detalhe(a: AppointmentView, comProfissional: boolean): string {
  const partes = [a.items.map((i) => i.name).join(' + '), formatDuration(a.totalDurationMin)]
  if (comProfissional) partes.push(`com ${a.professional.name}`)
  return partes.filter((p) => p !== '').join(' · ')
}

/** A frase do bloco "Hoje": quantos atendimentos há e quantos já foram concluídos. */
function resumo(todos: boolean, total: number, concluidos: number): string {
  if (total === 0) return todos ? 'A agenda de hoje está livre.' : 'Você não tem atendimentos hoje.'
  const feitos = concluidos === 0 ? '' : concluidos === 1 ? ', 1 já concluído' : `, ${concluidos} já concluídos`
  return `${todos ? 'A agenda de hoje tem' : 'Você tem'} ${ATENDIMENTO(total)}${todos ? '' : ' hoje'}${feitos}.`
}

function Situacao({ status }: { status: AppointmentView['status'] }) {
  return status === 'PENDING' ? <StatusBadge tone="pending">Aguardando confirmação</StatusBadge> : <StatusBadge tone="confirmed">Confirmado</StatusBadge>
}

export default async function InicioPage() {
  const ctx = await requireTenant('view_dashboard')
  const home = await getHomeOverview(ctx)
  const todos = home.scope === 'all'
  const { next, later, summary, counts } = home
  const concluidos = summary.byStatus.COMPLETED
  const ocupacao = summary.occupancy
  const quando =
    next && next.local.date !== home.date ? (next.local.date === addDays(home.date, 1) ? 'Amanhã' : shortDate(next.local.date)) : next ? 'Hoje' : null
  const podeBloquear = can(ctx.actor, 'manage_own_availability')

  return (
    <PainelFrame ctx={ctx} title="Início">
      <div className="af-home">
        <div className="af-home__top">
          <Card variant="block" bubbles as="section" aria-labelledby="inicio-hoje" className="af-home__hero">
            <h2 id="inicio-hoje" className="af-home__hero-title">
              Hoje
            </h2>
            <p className="af-home__date">
              <time dateTime={home.date}>
                {weekdayName(home.weekday)}, {home.dateLabel}
              </time>
            </p>
            {ocupacao !== null ? (
              <p className="af-home__occupancy">
                <span className="af-home__occupancy-value">{Math.round(ocupacao * 100)}%</span>
                <span className="af-home__occupancy-text">da agenda ocupada</span>
              </p>
            ) : (
              <p className="af-home__occupancy-text">Sem expediente hoje.</p>
            )}
            <p className="af-home__summary">{resumo(todos, counts.today, concluidos)}</p>
          </Card>

          {next ? (
            <Card as="section" aria-labelledby="inicio-proximo" className="af-home__next">
              <h2 id="inicio-proximo" className="af-home__section-title">
                Próximo atendimento
              </h2>
              <div className="af-home__next-head">
                <TimeChip time={next.local.start} readOnly />
                <span className="af-home__next-when">{quando}</span>
              </div>
              <p className="af-home__next-name">{next.customer.name}</p>
              <p className="af-home__next-detail">{detalhe(next, todos)}</p>
              <div className="af-home__next-foot">
                <Situacao status={next.status} />
                <PhoneLink phone={next.customer.phoneLabel} />
              </div>
            </Card>
          ) : (
            <Card as="section" aria-label="Próximo atendimento">
              <EmptyState
                title="Nenhum atendimento por vir"
                description="Sua agenda está livre por enquanto. Que tal marcar o primeiro horário?"
                action={
                  <LinkButton href="/agenda?acao=marcar" variant="primary" icon={<CalendarPlus size={18} />}>
                    Marcar horário
                  </LinkButton>
                }
              />
            </Card>
          )}
        </div>

        <div className="af-home__lower">
          <Card as="section" aria-labelledby="inicio-resto" className="af-home__card">
            <h2 id="inicio-resto" className="af-home__section-title">
              Mais hoje
            </h2>
            {later.length > 0 ? (
              <ul className="af-home__list">
                {later.map((a) => (
                  <li key={a.id} className="af-home__row">
                    <time className="af-home__row-time" dateTime={`${a.local.date}T${a.local.start}`}>
                      {a.local.start}
                    </time>
                    <div className="af-home__row-main">
                      <span className="af-home__row-name">{a.customer.name}</span>
                      <span className="af-home__row-detail">{detalhe(a, todos)}</span>
                      {a.status === 'PENDING' ? <Situacao status={a.status} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>{next && next.local.date === home.date ? 'Este é o último atendimento de hoje.' : 'Nenhum atendimento até o fim do dia.'}</EmptyHint>
            )}
          </Card>

          <div className="af-home__side">
            <Card as="section" aria-labelledby="inicio-numeros" className="af-home__card">
              <h2 id="inicio-numeros" className="af-home__section-title">
                Números
              </h2>
              <div className="af-home__numbers">
                <StatNumber value={counts.today} label="Atendimentos hoje" size="md" />
                <StatNumber value={counts.month} label="Atendimentos no mês" size="md" />
              </div>
            </Card>

            <Card as="section" aria-labelledby="inicio-atalhos" className="af-home__card">
              <h2 id="inicio-atalhos" className="af-home__section-title">
                Atalhos
              </h2>
              <div className="af-home__actions">
                <LinkButton href="/agenda?acao=marcar" variant="primary" icon={<CalendarPlus size={18} />}>
                  Marcar horário
                </LinkButton>
                {podeBloquear ? (
                  <LinkButton href="/agenda?acao=bloquear" variant="secondary" icon={<CalendarX2 size={18} />}>
                    Bloquear horário
                  </LinkButton>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PainelFrame>
  )
}
