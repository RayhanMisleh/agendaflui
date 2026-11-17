'use client'
import Link from 'next/link'
import { DataList } from '@/ui/components'
import type { DataColumn } from '@/ui/components'

export type ContaQuieta = { id: string; name: string; ultima: string | null }

const COLUNAS: DataColumn<ContaQuieta>[] = [
  {
    key: 'conta',
    header: 'Conta',
    primary: true,
    cell: (c) => (
      <Link href={`/contas/${c.id}`} className="af-account__name">
        {c.name}
      </Link>
    ),
  },
  { key: 'ultima', header: 'Última atividade', nowrap: true, cell: (c) => c.ultima ?? 'Nunca teve atividade' },
]

/** Contas ativas sem agendamento recente, cada uma com atalho para a página da conta. */
export function QuietTable({ contas }: { contas: ContaQuieta[] }) {
  return <DataList label="Contas sem atividade recente" columns={COLUNAS} rows={contas} rowKey={(c) => c.id} empty={null} />
}
