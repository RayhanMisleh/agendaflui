'use client'
import { DataList } from '@/ui/components'
import type { DataColumn } from '@/ui/components'
import { formatMoney } from '@/ui/format'

export type ItemDoPedido = { key: string; name: string; unitPriceCents: number; quantity: number; totalCents: number }
export type PagamentoDoPedido = { id: string; situacao: string; amountCents: number; updatedLabel: string }

const COLUNAS_ITENS: DataColumn<ItemDoPedido>[] = [
  { key: 'name', header: 'Item', primary: true, cell: (i) => i.name },
  { key: 'unit', header: 'Preço da compra', align: 'end', nowrap: true, cell: (i) => formatMoney(i.unitPriceCents) },
  { key: 'qty', header: 'Qtd.', align: 'end', nowrap: true, cell: (i) => i.quantity },
  { key: 'total', header: 'Total', align: 'end', nowrap: true, cell: (i) => formatMoney(i.totalCents) },
]

const COLUNAS_PAGAMENTOS: DataColumn<PagamentoDoPedido>[] = [
  { key: 'situacao', header: 'Situação', primary: true, cell: (p) => p.situacao },
  { key: 'valor', header: 'Valor', align: 'end', nowrap: true, cell: (p) => formatMoney(p.amountCents) },
  { key: 'id', header: 'Identificador no Mercado Pago', cell: (p) => <span className="af-tabular">{p.id}</span> },
  { key: 'updated', header: 'Atualizado em', cell: (p) => p.updatedLabel },
]

/** Itens do pedido: tabela no desktop, cartões no celular. */
export function ItensDoPedido({ itens }: { itens: ItemDoPedido[] }) {
  return <DataList label="Itens do pedido" columns={COLUNAS_ITENS} rows={itens} rowKey={(i) => i.key} empty={null} />
}

/** Pagamentos do Mercado Pago recebidos para o pedido. */
export function PagamentosDoPedido({ pagamentos }: { pagamentos: PagamentoDoPedido[] }) {
  return <DataList label="Pagamentos do pedido" columns={COLUNAS_PAGAMENTOS} rows={pagamentos} rowKey={(p) => p.id} empty={null} />
}
