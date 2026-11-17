import type { Metadata } from 'next'
import { Counter, Paper } from '@/ui/components'
import { DomainError } from '@/server/domain/errors'
import { getAccountMetrics } from '@/server/domain/platform/metrics'
import { formatDateTime } from '@/server/time'
import { carregarConta } from './_data'
import { salvarDados } from './actions'
import { DadosForm } from './FormsConta'

export const metadata: Metadata = { title: 'Conta | AgendaFlui' }

/** O que cada código de `?faltou=` quer dizer. O código vem da criação em etapas; nunca traz segredo. */
const FALTOU: Record<string, string> = {
  marca: 'a marca (cores, material e fontes)',
  logo: 'a logo',
  termos: 'os termos',
  modulos: 'os módulos',
  regras: 'as regras de agenda',
  chave: 'a chave de app',
}

const SUPORTE: Record<string, string> = {
  arquivada: 'Esta conta está arquivada. Reative a conta para entrar como suporte.',
  falhou: 'Não foi possível entrar como suporte agora. Tente de novo; se continuar, confira se a conta está ativa.',
}

function um(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

export default async function ContaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const q = await searchParams
  const { admin, conta } = await carregarConta(id)
  const faltou = um(q.faltou)
    .split(',')
    .map((c) => FALTOU[c])
    .filter((t): t is string => t !== undefined)
  const suporte = SUPORTE[um(q.suporte)]

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
      <Paper raised={1} className="af-listpanel">
        <h2 className="af-section__title">Números da conta</h2>
        {metricas ? (
          <>
            <div className="af-metrics">
              <Counter label="Agendamentos hoje" value={metricas.appointments.today} />
              <Counter label="Próximos 7 dias" value={metricas.appointments.next7d} />
              <Counter label="Agendamentos no mês" value={metricas.appointments.month.current} />
              <Counter label="Clientes" value={metricas.customers.total} />
              <Counter label="Clientes novos no mês" value={metricas.customers.newMonth} />
              <Counter label="Receita do mês" value={metricas.revenueCents.month.current} format="brl" />
              <Counter label="Equipe ativa" value={metricas.team.active} />
              <Counter label="Pessoas no app no mês" value={metricas.appUsers.activeMonth} />
            </div>
            <p className="af-listpanel__summary">
              Mês passado: {metricas.appointments.month.previous} agendamentos. Última atividade:{' '}
              {metricas.lastActivityAt ? formatDateTime(metricas.lastActivityAt, conta.timeZone) : 'nenhuma ainda'}.
            </p>
          </>
        ) : (
          <p className="af-wizard__note">{avisoMetricas}</p>
        )}
      </Paper>
      <Paper raised={1} className="af-listpanel">
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
      </Paper>
    </>
  )
}
