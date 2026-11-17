import type { Metadata } from 'next'
import { StatNumber, Card } from '@/ui/components'
import { DomainError } from '@/server/domain/errors'
import { getAccountMetrics } from '@/server/domain/platform/metrics'
import { HorariosNota } from '../../_lib/HorariosNota'
import { quando } from '../../_lib/format'
import { um } from '../../_lib/params'
import { carregarConta } from './_data'
import { salvarDados } from './actions'
import { DadosForm } from './FormsConta'
import { traduzirFaltou, traduzirSuporte } from './codigos-url'

export const metadata: Metadata = { title: 'Conta | AgendaFlui' }

export default async function ContaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const q = await searchParams
  const { admin, conta } = await carregarConta(id)
  const faltou = traduzirFaltou(um(q.faltou))
  const suporte = traduzirSuporte(um(q.suporte))

  let metricas: Awaited<ReturnType<typeof getAccountMetrics>> | null = null
  let avisoMetricas: string | null = null
  try {
    metricas = await getAccountMetrics(admin, conta.id, new Date())
  } catch (err) {
    if (!(err instanceof DomainError)) throw err
    avisoMetricas = err.message
  }

  return (
    <>
      {faltou.length > 0 ? (
        <p role="alert" className="af-wizard__note">
          A conta foi criada, mas não deu para salvar {faltou.join(', ')}. Confira esses itens nas abas e salve de novo.
        </p>
      ) : null}
      {suporte ? (
        <p role="alert" className="af-wizard__note">
          {suporte}
        </p>
      ) : null}
      <Card className="af-listpanel">
        <h2 className="af-section__title">Números da conta</h2>
        {metricas ? (
          <>
            <div className="af-metrics">
              <StatNumber label="Agendamentos hoje" value={metricas.appointments.today} />
              <StatNumber label="Próximos 7 dias" value={metricas.appointments.next7d} />
              <StatNumber label="Agendamentos no mês" value={metricas.appointments.month.current} />
              <StatNumber label="Clientes" value={metricas.customers.total} />
              <StatNumber label="Clientes novos no mês" value={metricas.customers.newMonth} />
              <StatNumber label="Receita do mês" value={metricas.revenueCents.month.current} format="brl" />
              <StatNumber label="Equipe ativa" value={metricas.team.active} />
              <StatNumber label="Pessoas no app no mês" value={metricas.appUsers.activeMonth} />
            </div>
            <p className="af-listpanel__summary">
              Mês passado: {metricas.appointments.month.previous} agendamentos. Última atividade:{' '}
              {metricas.lastActivityAt ? quando(metricas.lastActivityAt) : 'nenhuma ainda'}.
            </p>
            <HorariosNota />
          </>
        ) : (
          <p className="af-wizard__note">{avisoMetricas}</p>
        )}
      </Card>
      <Card className="af-listpanel">
        <h2 className="af-section__title">Dados da conta</h2>
        <DadosForm
          action={salvarDados.bind(null, conta.id)}
          valores={{
            version: String(conta.version),
            name: conta.name,
            slug: conta.slug,
            legalName: conta.legalName ?? '',
            document: conta.document ?? '',
            contactEmail: conta.contactEmail ?? '',
            contactPhone: conta.contactPhone ?? '',
            internalNotes: conta.internalNotes ?? '',
          }}
        />
      </Card>
    </>
  )
}
