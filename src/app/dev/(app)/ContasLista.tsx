'use client'
import { DataList, EmptyState, Paper, Stamp } from '@/ui/components'
import type { DataColumn, Tone } from '@/ui/components'

export type ContaLinha = { id: string; name: string; slug: string; status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'; entrada: string }

const SITUACAO: Record<ContaLinha['status'], { texto: string; tom: Tone }> = {
  ACTIVE: { texto: 'Ativa', tom: 'ok' },
  SUSPENDED: { texto: 'Suspensa', tom: 'warn' },
  ARCHIVED: { texto: 'Arquivada', tom: 'neutral' },
}

/** Quebra o endereço só depois das barras, para ele nunca partir no meio de uma palavra. */
function EnderecoQuebravel({ url }: { url: string }) {
  return url.split('/').map((parte, i, todas) => (
    <span key={i}>
      {parte}
      {i < todas.length - 1 ? '/' : ''}
      {i < todas.length - 1 ? <wbr /> : null}
    </span>
  ))
}

const COLUNAS: DataColumn<ContaLinha>[] = [
  { key: 'conta', header: 'Conta', primary: true, cell: (c) => <strong>{c.name}</strong> },
  { key: 'slug', header: 'Identificador', nowrap: true, cell: (c) => <code>{c.slug}</code> },
  {
    key: 'situacao',
    header: 'Situação',
    cell: (c) => <Stamp tone={SITUACAO[c.status].tom}>{SITUACAO[c.status].texto}</Stamp>,
  },
  {
    key: 'entrada',
    header: 'Link de entrada',
    cell: (c) => (
      <a href={c.entrada} className="af-link-break">
        <EnderecoQuebravel url={c.entrada} />
      </a>
    ),
  },
]

export function ContasLista({ contas }: { contas: ContaLinha[] }) {
  return (
    <Paper raised={1}>
      <DataList
        label="Contas"
        columns={COLUNAS}
        rows={contas}
        rowKey={(c) => c.id}
        empty={<EmptyState title="Nenhuma conta ainda" description="As contas criadas aparecem aqui." />}
      />
    </Paper>
  )
}
