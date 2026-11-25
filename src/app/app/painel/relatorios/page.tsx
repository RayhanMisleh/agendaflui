import type { Metadata } from 'next'
import { Download } from 'lucide-react'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { listServices } from '@/server/domain/catalog/services'
import { DomainError } from '@/server/domain/errors'
import { getReportByProfessional, getReportByService } from '@/server/domain/reports/breakdowns'
import { listReportRows } from '@/server/domain/reports/detail'
import { getReportSummary } from '@/server/domain/reports/summary'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { listProfessionals } from '@/server/domain/team/professionals'
import { todayIn } from '@/server/time'
import Form from 'next/form'
import { BarList, Card, DateRangeField, EmptyHint, Field, NavTabs, Pagination, Select, StatNumber, SubmitButton } from '@/ui/components'
import type { BarItem } from '@/ui/components'
import { formatLocalDate, formatMoney } from '@/ui/format'
import { um } from '@/app/_lib/params'
import { ShellPage } from '@/ui/shells'
import { ATALHOS, periodoDaUrl } from './periodo'
import { Detalhe, PorProfissional, PorServico } from './RelatorioTabelas'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Relatórios | Agenda Flui' }

const TRACO = '—'
const dinheiro = (c: number | null): string => (c === null ? TRACO : formatMoney(c))

/** Com mais de dois meses, as barras somam por mês: 366 linhas não se leem. */
function barras(porDia: { date: string; revenueCents: number }[]): BarItem[] {
  if (porDia.length <= 62) {
    return porDia.map((d) => ({ key: d.date, label: formatLocalDate(d.date).slice(0, 5), value: d.revenueCents, display: formatMoney(d.revenueCents) }))
  }
  const meses = new Map<string, number>()
  for (const d of porDia) meses.set(d.date.slice(0, 7), (meses.get(d.date.slice(0, 7)) ?? 0) + d.revenueCents)
  return [...meses].map(([mes, total]) => ({ key: mes, label: `${mes.slice(5)}/${mes.slice(2, 4)}`, value: total, display: formatMoney(total) }))
}

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant()
  const q = await searchParams
  const todos = can(ctx.actor, 'view_all_reports')
  await getPainelContext(ctx)
  const terms = TERMS
  const titulo = todos ? 'Relatórios' : 'Meus números'
  const periodo = periodoDaUrl({ atalho: um(q.atalho), de: um(q.de), ate: um(q.ate) }, todayIn(ctx.timeZone, ctx.clock()))
  const profissional = todos ? um(q.profissional) : ''
  const servico = um(q.servico)
  const cursor = um(q.cursor) || null

  const filtroDaUrl = (extra: Record<string, string | undefined> = {}): URLSearchParams => {
    const p = new URLSearchParams()
    if (periodo.atalho) p.set('atalho', periodo.atalho)
    else {
      p.set('de', periodo.from)
      p.set('ate', periodo.to)
    }
    if (profissional) p.set('profissional', profissional)
    if (servico) p.set('servico', servico)
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
    return p
  }
  const filtro = { from: periodo.from, to: periodo.to, ...(profissional ? { professionalId: profissional } : {}), ...(servico ? { serviceId: servico } : {}) }

  const [equipe, servicos] = await Promise.all([todos ? listProfessionals(ctx, { includeInactive: true }) : Promise.resolve([]), listServices(ctx, { includeInactive: true })])

  let dados: {
    resumo: Awaited<ReturnType<typeof getReportSummary>>
    porProfissional: Awaited<ReturnType<typeof getReportByProfessional>>
    porServico: Awaited<ReturnType<typeof getReportByService>>
    pagina: Awaited<ReturnType<typeof listReportRows>>
  } | null = null
  let aviso: string | null = null
  try {
    const [resumo, porProfissional, porServico, pagina] = await Promise.all([
      getReportSummary(ctx, filtro),
      getReportByProfessional(ctx, filtro),
      getReportByService(ctx, filtro),
      listReportRows(ctx, { ...filtro, ...(cursor ? { cursor } : {}), limit: 30 }),
    ])
    dados = { resumo, porProfissional, porServico, pagina }
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    aviso = err.message
  }

  const paramsLista = Object.fromEntries(filtroDaUrl()) as Record<string, string>
  const atalhos = ATALHOS.map((a) => ({
    id: a.id,
    label: a.label,
    href: `/painel/relatorios?${new URLSearchParams({ atalho: a.id, ...(profissional ? { profissional } : {}), ...(servico ? { servico } : {}) }).toString()}`,
    active: periodo.atalho === a.id,
  }))
  const resumo = dados?.resumo

  return (
    <ShellPage title={titulo}>
      <div className="af-report">
        <Card as="section" aria-label="Período e filtros" className="af-report__filters">
          <NavTabs label="Períodos prontos" items={atalhos} />
          <Form action="/painel/relatorios" className="af-report__form">
            <DateRangeField from={periodo.from} to={periodo.to} />
            {todos ? (
              <Field label={terms.professionalSingular}>
                <Select name="profissional" defaultValue={profissional}>
                  <option value="">Todos</option>
                  {equipe.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Serviço">
              <Select name="servico" defaultValue={servico}>
                <option value="">Todos</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton variant="primary">
              Ver período
            </SubmitButton>
          </Form>
          <p className="af-report__note">
            {periodo.from === periodo.to ? formatLocalDate(periodo.from) : `${formatLocalDate(periodo.from)} a ${formatLocalDate(periodo.to)}`}. Contam os atendimentos que terminaram no período.
          </p>
        </Card>

        {aviso ? (
          <p role="alert" className="af-report__error">
            {aviso}
          </p>
        ) : null}

        {dados && resumo ? (
          <>
            <Card as="section" aria-label="Resumo" className="af-report__stats">
              <StatNumber value={resumo.revenueCents} label="Receita" format="brl" size="md" />
              <StatNumber value={resumo.completed} label="Concluídos" size="md" />
              <StatNumber value={resumo.averageTicketCents} label="Ticket médio" format="brl" size="md" />
              {resumo.commissionCents !== null ? (
                <StatNumber value={resumo.commissionCents} label="Comissão" format="brl" size="md" />
              ) : (
                <div role="group" aria-label="Comissão" className="af-statnum af-statnum--md">
                  <div className="af-statnum__label">Comissão</div>
                  <div className="af-statnum__value">{TRACO}</div>
                </div>
              )}
              <p className="af-report__note">
                {resumo.canceled} cancelados e {resumo.noShow} faltas no período.
                {servico ? ' Com um serviço escolhido, a receita é só a dele e a comissão não se divide por serviço.' : ''}
              </p>
            </Card>

            <Card as="section" aria-labelledby="rel-dias">
              <h2 id="rel-dias" className="af-report__title">
                Receita {resumo.byDay.length > 62 ? 'por mês' : 'por dia'}
              </h2>
              {resumo.revenueCents === 0 ? <EmptyHint>Nenhuma receita neste período.</EmptyHint> : <BarList items={barras(resumo.byDay)} label="Receita no período" />}
            </Card>

            {todos ? (
              <Card as="section" aria-labelledby="rel-prof">
                <h2 id="rel-prof" className="af-report__title">
                  Por {terms.professionalSingular.toLowerCase()}
                </h2>
                <PorProfissional
                  termo={terms.professionalSingular}
                  linhas={dados.porProfissional.map((p) => ({ id: p.professionalId, name: p.name, completed: p.completed, revenue: formatMoney(p.revenueCents), commission: dinheiro(p.commissionCents) }))}
                />
              </Card>
            ) : null}

            <Card as="section" aria-labelledby="rel-serv">
              <h2 id="rel-serv" className="af-report__title">
                Por serviço
              </h2>
              <PorServico linhas={dados.porServico.map((s) => ({ id: s.serviceId, name: s.name, count: s.count, revenue: formatMoney(s.revenueCents) }))} />
            </Card>

            <Card as="section" aria-labelledby="rel-lista">
              <div className="af-report__head">
                <h2 id="rel-lista" className="af-report__title">
                  Atendimentos
                </h2>
                <a className="af-button af-button--secondary af-button--md" href={`/painel/relatorios/exportar?${filtroDaUrl().toString()}`} download>
                  <span className="af-button__label">
                    <span className="af-button__icon" aria-hidden="true">
                      <Download size={18} />
                    </span>
                    Baixar CSV
                  </span>
                </a>
              </div>
              <Detalhe
                comProfissional={todos}
                termoProfissional={terms.professionalSingular}
                termoCliente={terms.customerSingular}
                linhas={dados.pagina.items.map((r) => ({
                  id: r.id,
                  start: r.startLabel,
                  customer: r.customerName,
                  professional: r.professionalName,
                  services: r.services.join(', '),
                  status: r.status,
                  value: r.status === 'COMPLETED' ? formatMoney(r.totalCents) : TRACO,
                  commission: dinheiro(r.commissionCents),
                }))}
              />
              <Pagination basePath="/painel/relatorios" params={paramsLista} cursor={cursor} nextCursor={dados.pagina.nextCursor} />
            </Card>
          </>
        ) : null}
      </div>
    </ShellPage>
  )
}
