'use client'
import { useRouter } from 'next/navigation'
import { Avatar, DataList, StatusDot } from '@/ui/components'
import type { DataColumn, StateTone } from '@/ui/components'
import { ACCESS_STATUS_LABEL } from '@/server/domain/team/access-status'
import type { AccessStatus } from '@/server/domain/team/access-status'

export type EquipeLinha = {
  id: string
  name: string
  avatarUrl: string | null
  servicos: string[]
  ativo: boolean
  papel: string | null
  acesso: AccessStatus
}

const ACESSO_TOM: Record<AccessStatus, StateTone> = {
  active: 'success',
  invited: 'warning',
  invite_failed: 'danger',
  inactive: 'neutral',
  none: 'neutral',
}

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
      cell: (p) => <StatusDot tone={ACESSO_TOM[p.acesso]} label={ACCESS_STATUS_LABEL[p.acesso]} {...(p.papel ? { detail: p.papel } : {})} />,
    },
  ]
  return <DataList label="Equipe" columns={colunas} rows={linhas} rowKey={(p) => p.id} empty={vazio} stack="lg" onRowClick={(p) => router.push(`/painel/equipe/${p.id}`)} />
}
