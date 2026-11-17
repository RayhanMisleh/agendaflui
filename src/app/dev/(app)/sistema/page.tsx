import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { getSystemStatus } from '@/server/domain/platform/system'
import { EmptyState, Lamp, Paper } from '@/ui/components'
import type { LampState } from '@/ui/components'
import { DevFrame } from '../DevFrame'
import { quando, tamanho } from '../_lib/format'
import { ExecucoesTable, FalhasTable, TabelasTable } from './SistemaTables'
import { tentarDeNovo } from './actions'

export const metadata: Metadata = { title: 'Sistema | AgendaFlui' }

const INT = new Intl.NumberFormat('pt-BR')
const NOMES_TAREFA: Record<string, string> = { notifications: 'Envio de avisos', cleanup: 'Limpeza', usage_flush: 'Gravação do uso da API' }

export default async function SistemaPage() {
  const admin = await requirePlatformAdmin()
  const agora = new Date()
  const s = await getSystemStatus(admin, agora)
  const { queue } = s
  const filaLamp: LampState = queue.failed24h > 0 ? 'error' : queue.pending > 0 ? 'warn' : 'on'

  const falhas = s.recentFailures.map((f, i) => ({
    chave: `${f.notificationId ?? 'tarefa'}-${f.at.getTime()}-${i}`,
    quando: quando(f.at),
    tipo: f.kind,
    codigo: f.code,
    conta: f.businessName,
    tentar: f.notificationId ? tentarDeNovo.bind(null, f.notificationId) : null,
  }))
  const execucoes = s.scheduler.lastRuns.map((r, i) => ({
    chave: `${r.kind}-${r.startedAt.getTime()}-${i}`,
    tipo: NOMES_TAREFA[r.kind] ?? r.kind,
    inicio: quando(r.startedAt),
    duracao: r.finishedAt ? `${INT.format(Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()))} ms` : 'Não terminou',
    ok: r.ok,
    resumo: r.summary,
  }))

  return (
    <DevFrame admin={admin} title="Sistema">
      <div className="af-global">
        <Paper raised={1} className="af-listpanel">
          <h2 className="af-section__title">Fila de avisos</h2>
          <Lamp label="Fila de avisos" state={filaLamp} />
          <dl className="af-global__facts">
            <div>
              <dt>Pendentes</dt>
              <dd>{INT.format(queue.pending)}</dd>
            </div>
            <div>
              <dt>Mais antigo pendente</dt>
              <dd>{queue.oldestPendingAt ? quando(queue.oldestPendingAt) : 'Nenhum'}</dd>
            </div>
            <div>
              <dt>Falhas em 24 h</dt>
              <dd>{INT.format(queue.failed24h)}</dd>
            </div>
            <div>
              <dt>Descartados em 24 h</dt>
              <dd>{INT.format(queue.skipped24h)}</dd>
            </div>
          </dl>
        </Paper>

        <Paper raised={1} className="af-listpanel">
          <h2 className="af-section__title">Falhas recentes</h2>
          <p className="af-section__help">Últimas 24 horas. Reenviar devolve o aviso à fila; se ele já não estiver em falha, a tela avisa.</p>
          <FalhasTable
            falhas={falhas}
            vazio={<EmptyState title="Nenhuma falha nas últimas 24 horas" description="Quando um aviso ou uma tarefa falhar, ele aparece aqui com o código curto do erro." />}
          />
        </Paper>

        <div className="af-global__grid">
          <Paper raised={1} className="af-listpanel">
            <h2 className="af-section__title">Banco de dados</h2>
            <dl className="af-global__facts">
              <div>
                <dt>Tamanho total</dt>
                <dd>{tamanho(s.database.sizeBytes)}</dd>
              </div>
            </dl>
            <TabelasTable tabelas={s.database.largestTables.map((t) => ({ nome: t.name, tamanho: tamanho(t.bytes) }))} />
          </Paper>
          <Paper raised={1} className="af-listpanel">
            <h2 className="af-section__title">Agendador</h2>
            <ExecucoesTable
              execucoes={execucoes}
              vazio={<EmptyState title="Nenhuma execução registrada" description="O agendador grava cada rodada. Se nada aparece, confira se o worker está ligado neste ambiente." />}
            />
          </Paper>
        </div>
      </div>
    </DevFrame>
  )
}
