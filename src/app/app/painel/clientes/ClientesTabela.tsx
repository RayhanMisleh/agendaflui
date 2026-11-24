'use client'
import { useRouter } from 'next/navigation'
import { DataList, PhoneLink, StatusDot } from '@/ui/components'
import type { DataColumn } from '@/ui/components'

export type ClienteLinha = {
  id: string
  name: string
  phone: string | null
  phoneLabel: string | null
  email: string | null
  archived: boolean
  hasAccount: boolean
  isClubMember: boolean
}

/** A lista de clientes: a linha inteira abre a ficha; o telefone liga sem abrir a ficha. */
export function ClientesTabela({ clientes, vazio, clube }: { clientes: ClienteLinha[]; vazio: React.ReactNode; clube: string | null }) {
  const router = useRouter()
  const colunas: DataColumn<ClienteLinha>[] = [
    { key: 'nome', header: 'Nome', primary: true, cell: (c) => c.name },
    { key: 'telefone', header: 'Telefone', nowrap: true, cell: (c) => <PhoneLink phone={c.phone} label={c.phoneLabel ?? undefined} /> },
    { key: 'email', header: 'E-mail', cell: (c) => c.email ?? 'Sem e-mail' },
    {
      key: 'situacao',
      header: 'Situação',
      nowrap: true,
      cell: (c) => {
        const detalhes = [c.hasAccount ? 'Tem conta' : '', c.isClubMember && clube ? `Do ${clube}` : ''].filter((d) => d !== '').join(' · ')
        return c.archived ? <StatusDot tone="neutral" label="Arquivado" /> : <StatusDot tone="success" label="Ativo" {...(detalhes ? { detail: detalhes } : {})} />
      },
    },
  ]
  return <DataList label="Clientes" columns={colunas} rows={clientes} rowKey={(c) => c.id} empty={vazio} stack="lg" onRowClick={(c) => router.push(`/painel/clientes/${c.id}`)} />
}
