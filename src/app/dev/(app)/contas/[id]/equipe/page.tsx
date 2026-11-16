import type { Metadata } from 'next'
import { Paper } from '@/ui/components'
import { listTeam } from '@/server/domain/platform/team'
import { formatDateTime } from '@/server/time'
import { carregarConta } from '../_data'
import { TeamPanel } from '../TeamPanel'

export const metadata: Metadata = { title: 'Equipe da conta | AgendaFlui' }

export default async function EquipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const equipe = await listTeam(admin, conta.id)
  const membros = equipe.map((m) => ({
    membershipId: m.membershipId,
    name: m.name,
    email: m.email,
    role: m.role,
    active: m.active,
    hasPassword: m.hasPassword,
    lastLogin: m.lastLoginAt ? formatDateTime(m.lastLoginAt, conta.timeZone) : null,
  }))
  return (
    <Paper raised={1} className="af-listpanel">
      <h2 className="af-section__title">Equipe</h2>
      <TeamPanel businessId={conta.id} membros={membros} />
    </Paper>
  )
}
