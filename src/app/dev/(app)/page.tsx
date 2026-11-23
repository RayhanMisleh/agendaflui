import type { Metadata } from 'next'
import { ArrowRight, Plus } from 'lucide-react'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { getOverview } from '@/server/domain/platform/metrics'
import { formatBrl } from '@/server/notifications/render'
import { Card, EmptyState, LinkButton, Meter, MiniBars, STATE_TEXT, StatNumber, StatTile, StatusDot, describeTrend } from '@/ui/components'
import type { StateTone } from '@/ui/components'
import { formatInt } from '@/ui/format'
import { DevFrame } from './DevFrame'
import { HorariosNota } from './_lib/HorariosNota'
import { quando, taxaDeSucesso } from './_lib/format'
import { QuietTable } from './QuietTable'

export const metadata: Metadata = { title: 'Visão geral | AgendaFlui' }

const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })

function comparacao(t: { current: number; previousSamePeriod: number; previous: number }, fmt: (n: number) => string, nome: string) {
  return (
    <MiniBars
      label={nome}
      format={fmt}
      bars={[
        { label: 'Mês passado', value: t.previous },
        { label: 'Mesmo trecho', value: t.previousSamePeriod },
        { label: 'Este mês', value: t.current },
      ]}
    />
  )
}

export default async function VisaoGeralPage() {
  const admin = await requirePlatformAdmin()
  const o = await getOverview(admin, new Date())
  const total = o.accounts.active + o.accounts.suspended + o.accounts.archived
  const criar = (
    <LinkButton href="/contas/nova" variant="primary" icon={<Plus size={18} />}>
      Criar conta
    </LinkButton>
  )

  if (total === 0) {
    return (
      <DevFrame admin={admin} title="Visão geral" actions={criar}>
        <Card className="af-listpanel">
          <EmptyState
            title="Ainda não há dados para mostrar"
            description="Crie a primeira conta: você escolhe a marca, os termos e o dono, e os números começam a andar assim que houver agendamentos."
            action={
              <LinkButton href="/contas/nova" variant="primary" icon={<Plus size={18} />}>
                Criar a primeira conta
              </LinkButton>
            }
          />
        </Card>
      </DevFrame>
    )
  }

  const { requests24h, errors24h } = o.api
  const taxaErro = requests24h === 0 ? 0 : errors24h / requests24h
  const sucesso = taxaDeSucesso(requests24h, errors24h)
  const apiTone: StateTone = errors24h === 0 ? 'success' : taxaErro < 0.05 ? 'warning' : 'danger'
  const filaTone: StateTone = o.notifications.failed24h > 0 ? 'danger' : 'success'
  const quietas = o.quietAccounts.map((c) => ({ id: c.id, name: c.name, ultima: c.lastActivityAt ? quando(c.lastActivityAt) : null }))

  return (
    <DevFrame admin={admin} title="Visão geral" actions={criar}>
      <div className="af-overview">
        {o.skippedAccounts > 0 ? (
          <p className="af-wizard__note" role="note">
            {o.skippedAccounts === 1
              ? '1 conta ficou fora dos números porque o fuso horário dela está inválido.'
              : `${formatInt(o.skippedAccounts)} contas ficaram fora dos números porque o fuso horário delas está inválido.`}
          </p>
        ) : null}

        <Card as="section" variant="block" bubbles aria-labelledby="vg-hoje" className="af-hero">
          <h2 id="vg-hoje" className="af-hero__title">
            Hoje na plataforma
          </h2>
          <div className="af-hero__numbers">
            <StatNumber label="Agendamentos hoje" value={o.appointments.today} />
            <StatNumber label="Contas ativas" value={o.accounts.active} />
            <StatNumber label="Usuários do app hoje" value={o.appUsers.activeToday} />
          </div>
          <p className="af-hero__note">
            {formatInt(o.accounts.newLast30d)} {o.accounts.newLast30d === 1 ? 'conta nova' : 'contas novas'} em 30 dias, {formatInt(o.accounts.suspended)}{' '}
            {o.accounts.suspended === 1 ? 'suspensa' : 'suspensas'} e {formatInt(o.accounts.archived)} {o.accounts.archived === 1 ? 'arquivada' : 'arquivadas'}.
          </p>
        </Card>

        <section aria-labelledby="vg-mes" className="af-overview__section">
          <h3 id="vg-mes" className="af-section__title">
            Este mês
          </h3>
          <p className="af-section__help">Cada número se compara ao mesmo trecho do mês passado, para não pesar um mês pela metade contra um mês inteiro.</p>
          <div className="af-tiles">
            <Card>
              <StatTile label="Agendamentos no mês" value={o.appointments.month.current} trend={describeTrend(o.appointments.month)}>
                {comparacao(o.appointments.month, (n) => formatInt(n), 'Agendamentos')}
              </StatTile>
            </Card>
            <Card>
              <StatTile label="Receita no mês" value={o.revenueCents.month.current} format="brl" trend={describeTrend(o.revenueCents.month, formatBrl)}>
                {comparacao(o.revenueCents.month, formatBrl, 'Receita')}
              </StatTile>
            </Card>
            {o.store.accounts > 0 ? (
              <>
                <Card>
                  <StatTile label="Pedidos pagos da loja no mês" value={o.store.paidOrders.current} trend={describeTrend(o.store.paidOrders)}>
                    {comparacao(o.store.paidOrders, (n) => formatInt(n), 'Pedidos pagos')}
                    <p className="af-tile__note">
                      {formatInt(o.store.accounts)} {o.store.accounts === 1 ? 'conta com Loja ligada' : 'contas com Loja ligada'}.
                    </p>
                  </StatTile>
                </Card>
                <Card>
                  <StatTile label="Receita da loja no mês" value={o.store.revenueCents.current} format="brl" trend={describeTrend(o.store.revenueCents, formatBrl)}>
                    {comparacao(o.store.revenueCents, formatBrl, 'Receita da loja')}
                  </StatTile>
                </Card>
              </>
            ) : null}
            <Card>
              <StatTile label="Clientes novos no mês" value={o.customers.newMonth.current} trend={describeTrend(o.customers.newMonth)}>
                {comparacao(o.customers.newMonth, (n) => formatInt(n), 'Clientes novos')}
              </StatTile>
            </Card>
            <Card>
              <StatTile label="Clientes cadastrados" value={o.customers.total} />
            </Card>
            <Card>
              <StatTile label="Usuários do app no mês" value={o.appUsers.activeMonth}>
                <p className="af-tile__note">{formatInt(o.appUsers.activeToday)} hoje.</p>
              </StatTile>
            </Card>
          </div>
        </section>

        <section aria-labelledby="vg-sistema" className="af-overview__section">
          <h3 id="vg-sistema" className="af-section__title">
            API e avisos nas últimas 24 horas
          </h3>
          <div className="af-tiles">
            <Card>
              <StatTile label={requests24h === 1 ? 'Requisição à API' : 'Requisições à API'} value={requests24h}>
                <StatusDot label="API do aplicativo" tone={apiTone} detail={STATE_TEXT[apiTone]} />
                <p className="af-tile__note">
                  {formatInt(errors24h)} {errors24h === 1 ? 'erro' : 'erros'}.
                </p>
                {requests24h > 0 ? <Meter label="Requisições sem erro" display={PCT.format(sucesso)} value={sucesso} /> : <p className="af-tile__note">Nenhuma requisição nas últimas 24 horas.</p>}
              </StatTile>
            </Card>
            <Card>
              <StatTile label="Avisos na fila" value={o.notifications.pending}>
                <StatusDot label="Fila de avisos" tone={filaTone} detail={STATE_TEXT[filaTone]} />
                <p className="af-tile__note">
                  {formatInt(o.notifications.failed24h)} {o.notifications.failed24h === 1 ? 'falha' : 'falhas'} em 24 h.
                </p>
                <LinkButton href="/sistema" icon={<ArrowRight size={18} />}>
                  Ver o sistema
                </LinkButton>
              </StatTile>
            </Card>
          </div>
        </section>

        <section aria-labelledby="vg-quietas" className="af-overview__section">
          <h3 id="vg-quietas" className="af-section__title">
            Contas sem atividade recente
          </h3>
          <Card className="af-listpanel">
            {quietas.length === 0 ? (
              <EmptyState title="Todas as contas ativas tiveram atividade" description="Quando uma conta ficar 14 dias sem agendamento, ela aparece aqui, com o nome levando à página dela." />
            ) : (
              <>
                <HorariosNota />
                <QuietTable contas={quietas} />
              </>
            )}
          </Card>
        </section>

        <p className="af-overview__links">
          <LinkButton href="/contas" icon={<ArrowRight size={18} />}>
            Ver todas as contas
          </LinkButton>
          <LinkButton href="/vitrine" variant="ghost">
            Vitrine de componentes
          </LinkButton>
        </p>
      </div>
    </DevFrame>
  )
}
