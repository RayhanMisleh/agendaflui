'use client'
import { DataList } from '@/ui/components'
import type { DataColumn } from '@/ui/components'

export type LinhaGlobal = { id: string; at: string; actor: string; action: string; conta: string | null; target: string | null; detail: string | null }

const COLUNAS: DataColumn<LinhaGlobal>[] = [
  { key: 'quando', header: 'Quando', primary: true, nowrap: true, cell: (l) => l.at },
  { key: 'quem', header: 'Quem', cell: (l) => l.actor },
  { key: 'acao', header: 'Ação', cell: (l) => <code>{l.action}</code> },
  { key: 'conta', header: 'Conta', cell: (l) => l.conta ?? 'Plataforma' },
  { key: 'alvo', header: 'Alvo', cell: (l) => l.target ?? 'Sem alvo' },
  {
    key: 'detalhe',
    header: 'Detalhe',
    cell: (l) =>
      l.detail ? (
        <details className="af-audit__detail">
          <summary>Ver detalhe</summary>
          {/* Texto puro: o JSON nunca é interpretado como HTML. */}
          <pre>{l.detail}</pre>
        </details>
      ) : (
        'Sem detalhe'
      ),
  },
]

export function GlobalAuditTable({ linhas, vazio }: { linhas: LinhaGlobal[]; vazio: React.ReactNode }) {
  return <DataList label="Auditoria da plataforma" columns={COLUNAS} rows={linhas} rowKey={(l) => l.id} empty={vazio} />
}
