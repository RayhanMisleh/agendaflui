import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Mail, MessageCircle } from 'lucide-react'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getCustomer } from '@/server/domain/customers/customers'
import type { CustomerView } from '@/server/domain/customers/customers'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import type { AppointmentView } from '@/server/domain/scheduling/appointment-view'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { AppointmentStatusBadge, Avatar, Card, EmptyHint, LinkButton, Pagination, PhoneLink, StatusDot } from '@/ui/components'
import { formatDuration, formatLocalDate, formatMoney } from '@/ui/format'
import { um } from '@/app/_lib/params'
import { PainelFrame } from '../../PainelFrame'
import { ClienteForm } from '../ClienteForm'
import { Cuidados } from '../Cuidados'

export const metadata: Metadata = { title: 'Ficha | AgendaFlui' }

function Atendimento({ a, comProfissional }: { a: AppointmentView; comProfissional: boolean }) {
  return (
    <li className="af-visit">
      <div className="af-visit__when">
        <time dateTime={a.local.date}>{formatLocalDate(a.local.date)}</time>
        <span className="af-visit__time">{a.local.start}</span>
      </div>
      <div className="af-visit__main">
        <span className="af-visit__what">{a.items.map((i) => i.name).join(' + ')}</span>
        <span className="af-visit__detail">
          {[formatDuration(a.totalDurationMin), formatMoney(a.totalCents), comProfissional ? `com ${a.professional.name}` : ''].filter((p) => p !== '').join(' · ')}
        </span>
        <AppointmentStatusBadge status={a.status} />
      </div>
    </li>
  )
}

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireTenant('view_clients')
  const { id } = await params
  const cursor = um((await searchParams).cursor) || null

  let cliente: CustomerView
  try {
    cliente = await getCustomer(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const [painel, proximos, historico] = await Promise.all([
    getPainelContext(ctx),
    listCustomerAppointments(ctx, { customerId: id, scope: 'upcoming', limit: 10 }),
    listCustomerAppointments(ctx, { customerId: id, scope: 'past', limit: 10, ...(cursor ? { cursor } : {}) }),
  ])
  const { terms } = painel
  const podeEscrever = can(ctx.actor, 'manage_clients')
  const suporte = ctx.actor.kind === 'impersonator'
  const removido = cliente.name === 'Cliente removido' && cliente.phone === null && cliente.email === null && cliente.archived
  const todos = can(ctx.actor, 'view_all_agendas')
  const zap = cliente.phone ? `https://wa.me/${cliente.phone.replace(/\D/g, '')}` : null
  const clube = painel.modules.loyalty ? terms.club : null

  return (
    <PainelFrame
      ctx={ctx}
      title={cliente.name}
      actions={
        <LinkButton href="/clientes" variant="ghost">
          Voltar para {terms.customerPlural.toLowerCase()}
        </LinkButton>
      }
    >
      <div className="af-profile">
        <Card as="section" aria-label="Resumo" className="af-profile">
          <div className="af-profile__head">
            <Avatar name={cliente.name} src={cliente.avatarUrl} size="lg" />
            <div className="af-profile__meta">
              {cliente.archived ? <StatusDot tone="neutral" label={removido ? 'Dados removidos' : 'Arquivado'} /> : <StatusDot tone="success" label="Ativo" {...(cliente.hasAppAccess ? { detail: 'Tem conta no app' } : {})} />}
              {clube && cliente.isClubMember ? <span>Do {clube}</span> : null}
            </div>
          </div>
          {cliente.phone || cliente.email ? (
            <div className="af-quick" aria-label={`Contato de ${cliente.name}`}>
              {cliente.phone ? <PhoneLink phone={cliente.phoneLabel} label={`Ligar ${cliente.phoneLabel ?? ''}`.trim()} /> : null}
              {zap ? (
                <LinkButton href={zap} variant="secondary" size="sm" icon={<MessageCircle size={16} />} external>
                  WhatsApp
                </LinkButton>
              ) : null}
              {cliente.email ? (
                <LinkButton href={`mailto:${cliente.email}`} variant="secondary" size="sm" icon={<Mail size={16} />}>
                  E-mail
                </LinkButton>
              ) : null}
            </div>
          ) : null}
        </Card>

        <div className="af-profile__cols">
          <div className="af-profile">
            <Card as="section" aria-labelledby="cliente-dados" className="af-profile">
              <h2 id="cliente-dados" className="af-section__title">
                Dados
              </h2>
              {podeEscrever && !cliente.archived ? (
                <ClienteForm
                  cliente={{ id: cliente.id, name: cliente.name, phoneLabel: cliente.phoneLabel, email: cliente.email, birthDate: cliente.birthDate, notes: cliente.notes ?? null, isClubMember: cliente.isClubMember }}
                  clube={clube}
                  singular={terms.customerSingular}
                />
              ) : (
                <dl className="af-facts">
                  <div>
                    <dt>Telefone</dt>
                    <dd>{cliente.phoneLabel ?? 'Sem telefone'}</dd>
                  </div>
                  <div>
                    <dt>E-mail</dt>
                    <dd>{cliente.email ?? 'Sem e-mail'}</dd>
                  </div>
                  <div>
                    <dt>Nascimento</dt>
                    <dd>{cliente.birthDate ? formatLocalDate(cliente.birthDate) : 'Não informado'}</dd>
                  </div>
                  <div>
                    <dt>Observações internas</dt>
                    <dd>{cliente.notes ? cliente.notes : 'Nenhuma observação.'}</dd>
                  </div>
                </dl>
              )}
            </Card>

            {podeEscrever && !removido ? (
              <Card as="section" aria-labelledby="cliente-cuidados" className="af-profile">
                <h2 id="cliente-cuidados" className="af-section__title">
                  Cuidados com o cadastro
                </h2>
                <Cuidados id={cliente.id} name={cliente.name} singular={terms.customerSingular} archived={cliente.archived} hasAppAccess={cliente.hasAppAccess} suporte={suporte} />
              </Card>
            ) : null}
          </div>

          <div className="af-profile">
            <Card as="section" aria-labelledby="cliente-proximos" className="af-profile">
              <h2 id="cliente-proximos" className="af-section__title">
                Próximos atendimentos
              </h2>
              {proximos.items.length > 0 ? (
                <ul className="af-home__list">
                  {proximos.items.map((a) => (
                    <Atendimento key={a.id} a={a} comProfissional={todos} />
                  ))}
                </ul>
              ) : (
                <EmptyHint>{cliente.archived ? 'Cadastro arquivado: sem atendimentos por vir.' : `${cliente.name} não tem atendimentos marcados.`}</EmptyHint>
              )}
            </Card>

            <Card as="section" aria-labelledby="cliente-historico" className="af-profile">
              <h2 id="cliente-historico" className="af-section__title">
                Histórico
              </h2>
              {historico.items.length > 0 ? (
                <ul className="af-home__list">
                  {historico.items.map((a) => (
                    <Atendimento key={a.id} a={a} comProfissional={todos} />
                  ))}
                </ul>
              ) : (
                <EmptyHint>Ainda não há atendimentos no histórico.</EmptyHint>
              )}
              <Pagination basePath={`/clientes/${cliente.id}`} params={{}} cursor={cursor} nextCursor={historico.nextCursor} />
            </Card>
          </div>
        </div>
      </div>
    </PainelFrame>
  )
}
