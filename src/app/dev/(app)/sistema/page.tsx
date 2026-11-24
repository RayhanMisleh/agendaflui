import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { getSystemStatus } from '@/server/domain/platform/system'
import { Card, EmptyState, STATE_TEXT, StatNumber, StatusDot } from '@/ui/components'
import type { StateTone } from '@/ui/components'
import { formatInt } from '@/ui/format'
import { ShellPage } from '@/ui/shells'
import { HorariosNota } from '../_lib/HorariosNota'
import { quando, tamanho } from '../_lib/format'
import { ExecucoesTable, FalhasTable, TabelasTable } from './SistemaTables'
import { EmailDeTeste } from './EmailDeTeste'
import { SistemaTabs } from './SistemaTabs'
import { enviarEmailDeTeste, tentarDeNovo } from './actions'

export const metadata: Metadata = { title: 'Sistema | Agenda Flui' }

const NOMES_TAREFA: Record<string, string> = { notifications: 'Envio de avisos', cleanup: 'Limpeza', store: 'Varredura da loja', retention: 'Retenção de dados' }

export default async function SistemaPage() {
  const admin = await requirePlatformAdmin()
  const agora = new Date()
  const s = await getSystemStatus(admin, agora)
  const { queue } = s
  const filaTone: StateTone = queue.failed24h > 0 ? 'danger' : queue.pending > 0 ? 'warning' : 'success'

  const falhas = s.recentFailures.map((f) => ({
    // Chave estável: o id do aviso (uma falha por aviso); falha de tarefa não tem id e vale pelo tipo, código e instante.
    chave: f.notificationId ?? `tarefa-${f.kind}-${f.code}-${f.at.getTime()}`,
    quando: quando(f.at),
    tipo: f.kind,
    codigo: f.code,
    conta: f.businessName,
    tentar: f.notificationId ? tentarDeNovo.bind(null, f.notificationId) : null,
  }))
  const execucoes = s.scheduler.lastRuns.map((r) => ({
    chave: `${r.kind}-${r.startedAt.getTime()}`,
    tipo: NOMES_TAREFA[r.kind] ?? r.kind,
    inicio: quando(r.startedAt),
    duracao: r.finishedAt ? `${formatInt(Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()))} ms` : 'Não terminou',
    ok: r.ok,
    resumo: r.summary,
  }))

  return (
    <ShellPage title="Sistema">
      <SistemaTabs />
      <HorariosNota />
      <div className="af-global">
        <Card className="af-listpanel">
          <h2 className="af-section__title">Fila de avisos</h2>
          <StatusDot label="Fila de avisos" tone={filaTone} detail={STATE_TEXT[filaTone]} />
          <div className="af-global__numbers">
            <StatNumber size="md" label="Pendentes" value={queue.pending} />
            <StatNumber size="md" label="Falhas em 24 h" value={queue.failed24h} />
            <StatNumber size="md" label="Descartados em 24 h" value={queue.skipped24h} />
          </div>
          <p className="af-section__help">Mais antigo pendente: {queue.oldestPendingAt ? quando(queue.oldestPendingAt) : 'nenhum'}.</p>
        </Card>

        <Card className="af-listpanel">
          <h2 className="af-section__title">E-mail</h2>
          <p className="af-section__help">Manda uma mensagem de teste para o seu e-mail de admin e mostra se o envio funcionou.</p>
          <EmailDeTeste acao={enviarEmailDeTeste} />
        </Card>

        <Card className="af-listpanel">
          <h2 className="af-section__title">Falhas recentes</h2>
          <p className="af-section__help">Últimas 24 horas. Reenviar devolve o aviso à fila; se ele já não estiver em falha, a tela avisa.</p>
          <FalhasTable
            falhas={falhas}
            vazio={<EmptyState title="Nenhuma falha nas últimas 24 horas" description="Quando um aviso ou uma tarefa falhar, ele aparece aqui com o código curto do erro." />}
          />
        </Card>

        <div className="af-global__grid">
          <Card className="af-listpanel">
            <h2 className="af-section__title">Banco de dados</h2>
            <dl className="af-global__facts">
              <div>
                <dt>Tamanho total</dt>
                <dd>{tamanho(s.database.sizeBytes)}</dd>
              </div>
            </dl>
            <TabelasTable tabelas={s.database.largestTables.map((t) => ({ nome: t.name, tamanho: tamanho(t.bytes) }))} />
          </Card>
          <Card className="af-listpanel">
            <h2 className="af-section__title">Agendador</h2>
            <ExecucoesTable
              execucoes={execucoes}
              vazio={<EmptyState title="Nenhuma execução registrada" description="O agendador grava cada rodada. Se nada aparece, confira se o worker está ligado neste ambiente." />}
            />
          </Card>
        </div>
      </div>
    </ShellPage>
  )
}
