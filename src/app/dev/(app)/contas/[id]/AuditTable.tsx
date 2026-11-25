'use client'
import { DataList, EmptyState } from '@/ui/components'
import type { DataColumn } from '@/ui/components'

export type LinhaAuditoria = { id: string; at: string; actor: string; action: string; target: string | null; detail: string | null }

const COLUNAS: DataColumn<LinhaAuditoria>[] = [
  { key: 'quando', header: 'Quando', primary: true, nowrap: true, cell: (l) => l.at },
  { key: 'quem', header: 'Quem', cell: (l) => l.actor },
  { key: 'acao', header: 'Ação', wide: true, cell: (l) => <code>{l.action}</code> },
  { key: 'alvo', header: 'Alvo', cell: (l) => l.target ?? 'Sem alvo' },
  {
    key: 'detalhe',
    header: 'Detalhe',
    cell: (l) =>
      l.detail ? (
        <details className="af-audit__detail">
          <summary>Ver detalhe</summary>
          <pre>{l.detail}</pre>
        </details>
      ) : (
        'Sem detalhe'
      ),
  },
]

export function AuditTable({ linhas, vazio }: { linhas: LinhaAuditoria[]; vazio: React.ReactNode }) {
  return <DataList label="Auditoria da conta" columns={COLUNAS} rows={linhas} rowKey={(l) => l.id} empty={vazio ?? <EmptyState title="Nada registrado" />} />
}
