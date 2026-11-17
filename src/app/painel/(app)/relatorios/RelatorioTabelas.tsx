'use client'
import { AppointmentStatusBadge, DataList, EmptyHint } from '@/ui/components'
import type { Situacao } from '@/ui/components/AppointmentStatusBadge'

export type LinhaProfissional = { id: string; name: string; completed: number; revenue: string; commission: string }
export type LinhaServico = { id: string; name: string; count: number; revenue: string }
export type LinhaDetalhe = {
  id: string
  start: string
  customer: string
  professional: string
  services: string
  status: Situacao
  value: string
  commission: string
}

/** Por profissional: concluídos, receita e comissão (o traço aparece quando a comissão não se aplica). */
export function PorProfissional({ linhas, termo }: { linhas: LinhaProfissional[]; termo: string }) {
  return (
    <DataList
      label={`Por ${termo.toLowerCase()}`}
      rows={linhas}
      rowKey={(l) => l.id}
      empty={<EmptyHint>Nenhum atendimento concluído neste período.</EmptyHint>}
      columns={[
        { key: 'name', header: termo, primary: true, cell: (l) => l.name },
        { key: 'done', header: 'Concluídos', align: 'end', nowrap: true, cell: (l) => l.completed },
        { key: 'revenue', header: 'Receita', align: 'end', nowrap: true, cell: (l) => l.revenue },
        { key: 'commission', header: 'Comissão', align: 'end', nowrap: true, cell: (l) => l.commission },
      ]}
    />
  )
}

export function PorServico({ linhas }: { linhas: LinhaServico[] }) {
  return (
    <DataList
      label="Por serviço"
      rows={linhas}
      rowKey={(l) => l.id}
      empty={<EmptyHint>Nenhum serviço concluído neste período.</EmptyHint>}
      columns={[
        { key: 'name', header: 'Serviço', primary: true, cell: (l) => l.name },
        { key: 'count', header: 'Vezes', align: 'end', nowrap: true, cell: (l) => l.count },
        { key: 'revenue', header: 'Receita', align: 'end', nowrap: true, cell: (l) => l.revenue },
      ]}
    />
  )
}

/** A lista detalhada; a coluna "Profissional" some para quem só vê os próprios números. */
export function Detalhe({ linhas, comProfissional, termoProfissional, termoCliente }: { linhas: LinhaDetalhe[]; comProfissional: boolean; termoProfissional: string; termoCliente: string }) {
  return (
    <DataList
      label="Atendimentos do período"
      rows={linhas}
      rowKey={(l) => l.id}
      stack="lg"
      empty={<EmptyHint>Nenhum atendimento terminou neste período.</EmptyHint>}
      columns={[
        { key: 'start', header: 'Início', primary: true, nowrap: true, cell: (l) => l.start },
        { key: 'customer', header: termoCliente, cell: (l) => l.customer },
        ...(comProfissional ? [{ key: 'professional', header: termoProfissional, cell: (l: LinhaDetalhe) => l.professional }] : []),
        { key: 'services', header: 'Serviços', cell: (l) => l.services },
        { key: 'status', header: 'Situação', cell: (l) => <AppointmentStatusBadge status={l.status} /> },
        { key: 'value', header: 'Valor', align: 'end', nowrap: true, cell: (l) => l.value },
        { key: 'commission', header: 'Comissão', align: 'end', nowrap: true, cell: (l) => l.commission },
      ]}
    />
  )
}
