import type { Metadata } from 'next'
import { EmptyState, LinkButton, Pagination, Paper } from '@/ui/components'
import { DomainError } from '@/server/domain/errors'
import { listAudit } from '@/server/domain/platform/audit-log'
import { formatDateTime } from '@/server/time'
import { carregarConta } from '../_data'
import { AuditTable } from '../AuditTable'

export const metadata: Metadata = { title: 'Auditoria da conta | AgendaFlui' }

function um(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? ''
}

export default async function AuditoriaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const q = await searchParams
  const { admin, conta } = await carregarConta(id)
  const cursor = um(q.cursor) || null
  let pagina: Awaited<ReturnType<typeof listAudit>> | null = null
  let aviso: string | null = null
  try {
    pagina = await listAudit(admin, { businessId: conta.id, ...(cursor ? { cursor } : {}), limit: 50 })
  } catch (err) {
    if (!(err instanceof DomainError) || err.code !== 'validation') throw err
    aviso = err.message
  }
  const linhas = (pagina?.items ?? []).map((a) => ({
    id: a.id,
    at: formatDateTime(a.at, conta.timeZone),
    actor: a.actorLabel,
    action: a.action,
    target: a.targetLabel,
    detail: a.metadata !== null && a.metadata !== undefined && JSON.stringify(a.metadata) !== '{}' ? JSON.stringify(a.metadata, null, 2) : null,
  }))
  const vazio = aviso ? (
    <EmptyState title="Esta página da lista não existe mais" description={aviso} action={<LinkButton href={`/contas/${conta.id}/auditoria`}>Voltar ao início da lista</LinkButton>} />
  ) : (
    <EmptyState title="Nada registrado nos últimos 30 dias" description="Toda mudança feita nesta conta, por você, pela equipe ou pelo sistema, aparece aqui." />
  )
  return (
    <Paper raised={1} className="af-listpanel">
      <h2 className="af-section__title">Auditoria dos últimos 30 dias</h2>
      <AuditTable linhas={linhas} vazio={vazio} />
      <Pagination basePath={`/contas/${conta.id}/auditoria`} params={{}} cursor={cursor} nextCursor={pagina?.nextCursor ?? null} />
    </Paper>
  )
}
