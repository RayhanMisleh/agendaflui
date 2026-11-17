import type { Metadata } from 'next'
import { ArrowRight, Plus } from 'lucide-react'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { getOverview } from '@/server/domain/platform/metrics'
import { formatBrl } from '@/server/notifications/render'
import { EmptyState, Gauge, Lamp, LinkButton, MiniBars, Paper, StatTile, describeTrend } from '@/ui/components'
import type { LampState } from '@/ui/components'
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
        <div className="af-bench">
          <Paper raised={1} className="af-listpanel">
            <EmptyState
              title="Ainda não há dados para mostrar"
              description="Crie a primeira conta: você escolhe a marca, os termos e o dono, e os mostradores começam a andar assim que houver agendamentos."
              action={
                <LinkButton href="/contas/nova" variant="primary" icon={<Plus size={18} />}>
                  Criar a primeira conta
                </LinkButton>
              }
            />
          </Paper>
        </div>
      </DevFrame>
    )
  }

  const { requests24h, errors24h } = o.api
  const taxaErro = requests24h === 0 ? 0 : errors24h / requests24h
  const sucesso = taxaDeSucesso(requests24h, errors24h)
  const apiLamp: LampState = errors24h === 0 ? 'on' : taxaErro < 0.05 ? 'warn' : 'error'
  const filaLamp: LampState = o.notifications.failed24h > 0 ? 'error' : 'on'
  const quietas = o.quietAccounts.map((c) => ({ id: c.id, name: c.name, ultima: c.lastActivityAt ? quando(c.lastActivityAt) : null }))

  return (
    <DevFrame admin={admin} title="Visão geral" actions={criar}>
      <div className="af-bench">
        {o.skippedAccounts > 0 ? (
          <p className="af-bench__note" role="note">
            {o.skippedAccounts === 1
              ? '1 conta ficou fora dos números porque o fuso horário dela está inválido. Corrija o fuso na página da conta.'
              : `${formatInt(o.skippedAccounts)} contas ficaram fora dos números porque o fuso horário delas está inválido. Corrija o fuso na página de cada conta.`}
          </p>
        ) : null}

        <section aria-labelledby="vg-agora" className="af-bench__section">
          <h3 id="vg-agora" className="af-bench__title">
            Agora
          </h3>
          <div className="af-bench__panel af-bench__panel--tiles af-glass">
            <StatTile className="af-stat--lead" label="Contas ativas" value={o.accounts.active} digits={3}>
              <p className="af-bench__small">
                {formatInt(o.accounts.newLast30d)} {o.accounts.newLast30d === 1 ? 'nova' : 'novas'} em 30 dias. {formatInt(o.accounts.suspended)}{' '}
                {o.accounts.suspended === 1 ? 'suspensa' : 'suspensas'}, {formatInt(o.accounts.archived)} {o.accounts.archived === 1 ? 'arquivada' : 'arquivadas'}.
              </p>
            </StatTile>
            <StatTile className="af-stat--lead" label="Agendamentos hoje" value={o.appointments.today} digits={3} />
            <StatTile label="Usuários do app hoje" value={o.appUsers.activeToday} digits={3}>
              <p className="af-bench__small">{formatInt(o.appUsers.activeMonth)} no mês.</p>
            </StatTile>
            <StatTile label="Clientes cadastrados" value={o.customers.total} digits={3} />
          </div>
        </section>

        <section aria-labelledby="vg-mes" className="af-bench__section">
          <h3 id="vg-mes" className="af-bench__title">
            Este mês
          </h3>
          <p className="af-bench__help">Cada número se compara ao mesmo trecho do mês passado, para não pesar um mês pela metade contra um mês inteiro.</p>
          <div className="af-bench__panel af-bench__panel--tiles af-glass">
            <StatTile label="Agendamentos no mês" value={o.appointments.month.current} digits={3} trend={describeTrend(o.appointments.month)}>
              {comparacao(o.appointments.month, (n) => formatInt(n), 'Agendamentos')}
            </StatTile>
            <StatTile label="Receita no mês" value={o.revenueCents.month.current} format="brl" trend={describeTrend(o.revenueCents.month, formatBrl)}>
              {comparacao(o.revenueCents.month, formatBrl, 'Receita')}
            </StatTile>
            <StatTile label="Clientes novos no mês" value={o.customers.newMonth.current} digits={3} trend={describeTrend(o.customers.newMonth)}>
              {comparacao(o.customers.newMonth, (n) => formatInt(n), 'Clientes novos')}
            </StatTile>
          </div>
        </section>

        <section aria-labelledby="vg-sistema" className="af-bench__section">
          <h3 id="vg-sistema" className="af-bench__title">
            API e avisos nas últimas 24 horas
          </h3>
          <div className="af-bench__panel af-bench__panel--lamps af-glass">
            <div>
              <Lamp label="API do aplicativo" state={apiLamp} />
              <p className="af-bench__small">
                {formatInt(requests24h)} {requests24h === 1 ? 'requisição' : 'requisições'}, {formatInt(errors24h)} {errors24h === 1 ? 'erro' : 'erros'}.
              </p>
            </div>
            <div>
              <Lamp label="Fila de avisos" state={filaLamp} />
              <p className="af-bench__small">
                {formatInt(o.notifications.pending)} na fila, {formatInt(o.notifications.failed24h)} {o.notifications.failed24h === 1 ? 'falha' : 'falhas'} em 24 h.
              </p>
              <LinkButton href="/sistema" icon={<ArrowRight size={18} />}>
                Ver o sistema
              </LinkButton>
            </div>
            {requests24h > 0 ? (
              <Gauge label="Requisições sem erro" display={PCT.format(sucesso)} value={sucesso} />
            ) : (
              <p className="af-bench__small">Nenhuma requisição à API nas últimas 24 horas.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="vg-quietas" className="af-bench__section">
          <h3 id="vg-quietas" className="af-bench__title">
            Contas sem atividade recente
          </h3>
          <Paper raised={1} className="af-listpanel">
            {quietas.length === 0 ? (
              <EmptyState title="Todas as contas ativas tiveram atividade" description="Quando uma conta ficar 14 dias sem agendamento, ela aparece aqui, com o nome levando à página dela." />
            ) : (
              <>
                <HorariosNota />
                <QuietTable contas={quietas} />
              </>
            )}
          </Paper>
        </section>

        <p className="af-home__row">
          <LinkButton href="/contas" icon={<ArrowRight size={18} />}>
            Ver todas as contas
          </LinkButton>
          <LinkButton href="/vitrine">Vitrine de componentes</LinkButton>
        </p>
      </div>
    </DevFrame>
  )
}
