'use client'
import { useRouter } from 'next/navigation'
import { Avatar, DataList, StatusDot } from '@/ui/components'
import type { DataColumn } from '@/ui/components'

export type EquipeLinha = {
  id: string
  name: string
  avatarUrl: string | null
  servicos: string[]
  ativo: boolean
  papel: string | null
  acesso: 'ativo' | 'convite' | 'desativado' | 'sem'
}

const ACESSO = {
  ativo: { tone: 'success', label: 'Acesso ativo' },
  convite: { tone: 'warning', label: 'Convite enviado' },
  desativado: { tone: 'neutral', label: 'Acesso desativado' },
  sem: { tone: 'neutral', label: 'Sem acesso ao painel' },
} as const

/** A lista da equipe: a linha inteira abre a ficha. */
export function EquipeTabela({ linhas, vazio }: { linhas: EquipeLinha[]; vazio: React.ReactNode }) {
  const router = useRouter()
  const colunas: DataColumn<EquipeLinha>[] = [
    {
      key: 'nome',
      header: 'Nome',
      primary: true,
      cell: (p) => (
        <span className="af-service">
          <Avatar name={p.name} src={p.avatarUrl} size="sm" />
          <span className="af-service__name">{p.name}</span>
        </span>
      ),
    },
    { key: 'servicos', header: 'Serviços', cell: (p) => (p.servicos.length > 0 ? p.servicos.join(', ') : 'Nenhum serviço marcado') },
    { key: 'situacao', header: 'Situação', nowrap: true, cell: (p) => (p.ativo ? <StatusDot tone="success" label="Disponível" /> : <StatusDot tone="warning" label="Fora de uso" detail="Não aparece para marcar" />) },
    {
      key: 'acesso',
      header: 'Acesso',
      cell: (p) => <StatusDot tone={ACESSO[p.acesso].tone} label={ACESSO[p.acesso].label} {...(p.papel ? { detail: p.papel } : {})} />,
    },
  ]
  return <DataList label="Equipe" columns={colunas} rows={linhas} rowKey={(p) => p.id} empty={vazio} stack="lg" onRowClick={(p) => router.push(`/equipe/${p.id}`)} />
}
