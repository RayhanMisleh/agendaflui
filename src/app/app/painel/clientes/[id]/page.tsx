import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Mail, MessageCircle } from 'lucide-react'
import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getCustomer, isCustomerAnonymized } from '@/server/domain/customers/customers'
import type { CustomerView } from '@/server/domain/customers/customers'
import { getCustomerLoyalty, listLoyaltyEntries } from '@/server/domain/loyalty/ledger'
import { listPrizes } from '@/server/domain/loyalty/prizes'
import { listOrders } from '@/server/domain/store/orders'
import { listCustomerAppointments } from '@/server/domain/scheduling/agenda'
import type { AppointmentView } from '@/server/domain/scheduling/appointment-view'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { AppointmentStatusBadge, Avatar, Card, EmptyHint, LinkButton, OrderStatusBadge, Pagination, PhoneLink, StatNumber, StatusDot } from '@/ui/components'
import { formatDuration, formatLocalDate, formatMoney } from '@/ui/format'
import { um } from '@/app/_lib/params'
import Link from 'next/link'
import { PainelFrame } from '../../PainelFrame'
import { ClienteForm } from '../ClienteForm'
import { Cuidados } from '../Cuidados'
import { PontosAcoes } from './PontosAcoes'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Ficha | Agenda Flui' }

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

const TIPOS_DO_EXTRATO: Record<string, string> = {
  EARN: 'Pontos por atendimento',
  EARN_REVERSAL: 'Atendimento desfeito',
  REDEEM: 'Resgate de prêmio',
  REDEEM_REVERSAL: 'Resgate cancelado',
  ADJUST: 'Ajuste',
}

/** Saldo e extrato (todo membro com `view_clients`) e, para `manage_loyalty`, os prêmios do resgate no balcão. */
async function carregarPontos(ctx: TenantContext, customerId: string, cursor: string | null, gerencia: boolean) {
  const [resumo, extrato, premios] = await Promise.all([
    getCustomerLoyalty(ctx, customerId),
    listLoyaltyEntries(ctx, customerId, { limit: 10, ...(cursor ? { cursor } : {}) }),
    gerencia ? listPrizes(ctx) : Promise.resolve([]),
  ])
  return { saldo: resumo.balance, extrato, premios: premios.filter((p) => p.stock === null || p.stock > 0).map((p) => ({ id: p.id, name: p.name, costPoints: p.costPoints })) }
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
  const q = await searchParams
  const cursor = um(q.cursor) || null
  const cursorExtrato = um(q.extrato) || null

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
  const terms = TERMS
  const podeEscrever = can(ctx.actor, 'manage_clients')
  const removido = await isCustomerAnonymized(ctx, id)
  const todos = can(ctx.actor, 'view_all_agendas')
  const zap = cliente.phone ? `https://wa.me/${cliente.phone.replace(/\D/g, '')}` : null
  const clube = painel.modules.loyalty ? terms.club : null
  // Os 5 últimos pedidos, só com a Loja ligada e para quem gerencia a loja.
  const pedidos = painel.modules.store && can(ctx.actor, 'manage_store') ? (await listOrders(ctx, { customerId: id, limit: 5 })).items : null
  const pontos = painel.modules.loyalty ? await carregarPontos(ctx, id, cursorExtrato, can(ctx.actor, 'manage_loyalty')) : null

  return (
    <PainelFrame
      ctx={ctx}
      title={cliente.name}
      actions={
        <LinkButton href="/painel/clientes" variant="ghost">
          Voltar para {terms.customerPlural.toLowerCase()}
        </LinkButton>
      }
    >
      <div className="af-profile">
        <Card as="section" aria-label="Resumo" className="af-profile">
          <div className="af-profile__head">
            <Avatar name={cliente.name} src={cliente.avatarUrl} size="lg" />
            <div className="af-profile__meta">
              {cliente.archived ? <StatusDot tone="neutral" label={removido ? 'Dados removidos' : 'Arquivado'} /> : <StatusDot tone="success" label="Ativo" {...(cliente.hasAccount ? { detail: 'Tem conta' } : {})} />}
              {clube && cliente.isClubMember ? <span>Do {clube}</span> : null}
              {cliente.origin === 'APP' ? <span>Pelo link da loja</span> : null}
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
                  cliente={{ id: cliente.id, name: cliente.name, phoneLabel: cliente.phoneLabel, email: cliente.email, birthDate: cliente.birthDate, notes: cliente.notes ?? null, isClubMember: cliente.isClubMember, hasAccount: cliente.hasAccount }}
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
                <Cuidados id={cliente.id} name={cliente.name} archived={cliente.archived} />
              </Card>
            ) : null}
          </div>

          <div className="af-profile">
            {pontos ? (
              <Card as="section" aria-labelledby="cliente-pontos" className="af-profile">
                <h2 id="cliente-pontos" className="af-section__title">
                  {terms.pointsPlural}
                </h2>
                <StatNumber value={pontos.saldo} label={`Saldo de ${terms.pointsPlural.toLowerCase()}`} size="md" />
                {can(ctx.actor, 'manage_loyalty') && !cliente.archived ? (
                  <PontosAcoes customerId={cliente.id} nome={cliente.name} premios={pontos.premios} pontos={terms.pointsPlural} ponto={terms.pointsSingular} />
                ) : null}
                {pontos.extrato.items.length > 0 ? (
                  <ul className="af-home__list">
                    {pontos.extrato.items.map((e) => (
                      <li key={e.id} className="af-visit">
                        <div className="af-visit__when">
                          <span className="af-visit__time af-tabular">{e.points > 0 ? `+${e.points}` : String(e.points)}</span>
                        </div>
                        <div className="af-visit__main">
                          <span className="af-visit__what">{TIPOS_DO_EXTRATO[e.kind] ?? e.kind}</span>
                          <span className="af-visit__detail">{[e.createdLabel, e.reason ?? ''].filter((p) => p !== '').join(' · ')}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>Ainda não há movimentos de {terms.pointsPlural.toLowerCase()}.</EmptyHint>
                )}
                <Pagination
                  basePath={`/painel/clientes/${cliente.id}`}
                  params={{ cursor: cursor ?? undefined }}
                  cursor={cursorExtrato}
                  nextCursor={pontos.extrato.nextCursor}
                  paramName="extrato"
                />
              </Card>
            ) : null}

            {pedidos ? (
              <Card as="section" aria-labelledby="cliente-pedidos" className="af-profile">
                <h2 id="cliente-pedidos" className="af-section__title">
                  Pedidos da loja
                </h2>
                {pedidos.length > 0 ? (
                  <ul className="af-home__list">
                    {pedidos.map((o) => (
                      <li key={o.id} className="af-visit">
                        <div className="af-visit__when">
                          <Link href={`/painel/loja/pedidos/${o.id}`} className="af-visit__time af-tabular">
                            #{o.number}
                          </Link>
                        </div>
                        <div className="af-visit__main">
                          <span className="af-visit__what">{formatMoney(o.totalCents)}</span>
                          <span className="af-visit__detail">{o.createdLabel}</span>
                          <OrderStatusBadge status={o.status} fulfillmentStatus={o.fulfillmentStatus} deliveryMethod={o.deliveryMethod} attention={o.attention} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>Ainda não há pedidos da loja.</EmptyHint>
                )}
              </Card>
            ) : null}

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
              <Pagination basePath={`/painel/clientes/${cliente.id}`} params={{ extrato: cursorExtrato ?? undefined }} cursor={cursor} nextCursor={historico.nextCursor} />
            </Card>
          </div>
        </div>
      </div>
    </PainelFrame>
  )
}
