'use client'
import Link from 'next/link'
import { DataList, StatusBadge } from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import type { BadgeTone } from '@/ui/components'

/** Uma linha da lista de pedidos: tudo já em texto (o número com "#", o total em reais). */
export type PedidoLinha = {
  id: string
  numero: string
  cliente: string
  total: string
  criado: string
  entrega: string
  /** Texto da situação e cor do selo (a cor nunca vai sozinha). */
  situacao: string
  tom: BadgeTone
  /** Texto do selo de atenção ("Valor divergente"), se houver. */
  atencao: string | null
}

export function PedidosLista({ pedidos, vazio }: { pedidos: PedidoLinha[]; vazio: React.ReactNode }) {
  const colunas: DataColumn<PedidoLinha>[] = [
    {
      key: 'pedido',
      header: 'Pedido',
      primary: true,
      nowrap: true,
      cell: (p) => (
        <Link href={`/painel/loja/pedidos/${p.id}`} className="af-service__name">
          {p.numero}
        </Link>
      ),
    },
    { key: 'cliente', header: 'Cliente', cell: (p) => p.cliente },
    { key: 'total', header: 'Total', nowrap: true, align: 'end', cell: (p) => <span className="af-tabular">{p.total}</span> },
    { key: 'situacao', header: 'Situação', cell: (p) => (
        <span className="af-orderbadges">
          <StatusBadge tone={p.tom}>{p.situacao}</StatusBadge>
          {p.atencao === null ? null : <StatusBadge tone="no-show">{p.atencao}</StatusBadge>}
        </span>
      ),
    },
    { key: 'entrega', header: 'Entrega', cell: (p) => p.entrega },
    { key: 'criado', header: 'Feito em', nowrap: true, cell: (p) => p.criado },
  ]
  return <DataList label="Pedidos" columns={colunas} rows={pedidos} rowKey={(p) => p.id} stack="lg" empty={vazio} />
}
