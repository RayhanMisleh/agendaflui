import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarPlus, CalendarX2 } from 'lucide-react'
import { redirect } from 'next/navigation'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import type { AppointmentView } from '@/server/domain/scheduling/appointment-view'
import { getOnboarding, shouldRedirectToOnboarding } from '@/server/domain/onboarding/progress'
import { getHomeOverview } from '@/server/domain/scheduling/home'
import { getCustomerLink } from '@/server/domain/settings/customer-link'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { addDays } from '@/server/time'
import { Card, EmptyHint, EmptyState, LinkButton, PhoneLink, StatNumber, StatusBadge, TimeChip } from '@/ui/components'
import { formatDuration, shortDate, weekdayName } from '@/ui/format'
import { ChecklistComeco, mostraChecklist } from './_lib/ChecklistComeco'
import { LinkParaClientes } from './_lib/LinkParaClientes'
import { dispensar } from './comecar/actions'
import { ShellPage } from '@/ui/shells'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Início | Agenda Flui' }

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

/** O atendimento aberto na agenda do dia dele (a agenda abre a ficha pelo `ag`). */
const verNaAgenda = (a: AppointmentView): string => `/painel/agenda?data=${a.local.date}&ag=${a.id}`

function Situacao({ status }: { status: AppointmentView['status'] }) {
  return status === 'PENDING' ? <StatusBadge tone="pending">Aguardando confirmação</StatusBadge> : <StatusBadge tone="confirmed">Confirmado</StatusBadge>
}

export default async function InicioPage() {
  const ctx = await requireTenant('view_dashboard')
  // O dono que ainda não terminou nem dispensou o começo cai nele; o suporte e a equipe nunca são levados.
  if (await shouldRedirectToOnboarding(ctx)) redirect('/painel/comecar')
  const [home, , link, comeco] = await Promise.all([getHomeOverview(ctx), getPainelContext(ctx), getCustomerLink(ctx), getOnboarding(ctx)])
  const semFicha = home.unlinked
  const avisoSemFicha = `Seu acesso ainda não está ligado a uma ficha de ${TERMS.professionalSingular.toLowerCase()}. Peça ao dono da conta para resolver isso em ${TERMS.professionalPlural}.`
  const todos = home.scope === 'all'
  const { next, later, summary, counts } = home
  const concluidos = summary.byStatus.COMPLETED
  const ocupacao = summary.occupancy
  const quando =
    next && next.local.date !== home.date ? (next.local.date === addDays(home.date, 1) ? 'Amanhã' : shortDate(next.local.date)) : next ? 'Hoje' : null
  const podeBloquear = can(ctx.actor, 'manage_own_availability') && !semFicha

  return (
    <ShellPage title="Início">
      <div className="af-home">
        {mostraChecklist(comeco, ctx.clock()) ? <ChecklistComeco view={comeco} dismissAction={dispensar} /> : null}
        {link ? <LinkParaClientes link={link} /> : null}
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
            {semFicha ? null : ocupacao !== null ? (
              <p className="af-home__occupancy">
                <span className="af-home__occupancy-value">{Math.round(ocupacao * 100)}%</span>
                <span className="af-home__occupancy-text">da agenda ocupada</span>
              </p>
            ) : (
              <p className="af-home__occupancy-text">Sem expediente hoje.</p>
            )}
            <p className="af-home__summary">{semFicha ? avisoSemFicha : resumo(todos, counts.today, concluidos)}</p>
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
              <p className="af-home__next-name">
                <Link href={verNaAgenda(next)} className="af-home__link">
                  {next.customer.name}
                </Link>
              </p>
              <p className="af-home__next-detail">{detalhe(next, todos)}</p>
              <div className="af-home__next-foot">
                <Situacao status={next.status} />
                <PhoneLink phone={next.customer.phoneLabel} />
              </div>
            </Card>
          ) : semFicha ? (
            <Card as="section" aria-label="Próximo atendimento">
              <EmptyState title="Seu acesso ainda não tem ficha" description={avisoSemFicha} />
            </Card>
          ) : (
            <Card as="section" aria-label="Próximo atendimento">
              <EmptyState
                title="Nenhum atendimento por vir"
                description="Sua agenda está livre por enquanto. Que tal marcar o primeiro horário?"
                action={
                  <LinkButton href="/painel/agenda?acao=marcar" variant="primary" icon={<CalendarPlus size={18} />}>
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
                      <Link href={verNaAgenda(a)} className="af-home__row-name af-home__link">
                        {a.customer.name}
                      </Link>
                      <span className="af-home__row-detail">{detalhe(a, todos)}</span>
                      {a.status === 'PENDING' ? <Situacao status={a.status} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>{semFicha ? avisoSemFicha : next && next.local.date === home.date ? 'Este é o último atendimento de hoje.' : 'Nenhum atendimento até o fim do dia.'}</EmptyHint>
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
                <LinkButton href="/painel/agenda?acao=marcar" variant="primary" icon={<CalendarPlus size={18} />}>
                  Marcar horário
                </LinkButton>
                {podeBloquear ? (
                  <LinkButton href="/painel/agenda?acao=bloquear" variant="secondary" icon={<CalendarX2 size={18} />}>
                    Bloquear horário
                  </LinkButton>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </ShellPage>
  )
}
