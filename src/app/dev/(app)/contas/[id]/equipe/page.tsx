import type { Metadata } from 'next'
import { Card } from '@/ui/components'
import { listTeam } from '@/server/domain/platform/team'
import { HorariosNota } from '../../../_lib/HorariosNota'
import { quando } from '../../../_lib/format'
import { carregarConta } from '../_data'
import { alternarAcesso, convidarMembro, reenviarConvite, trocarPapel } from '../actions'
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
    lastLogin: m.lastLoginAt ? quando(m.lastLoginAt) : null,
  }))
  return (
    <Card className="af-listpanel">
      <h2 className="af-section__title">Equipe</h2>
      <HorariosNota />
      <TeamPanel
        membros={membros}
        acoes={{
          trocarPapel: trocarPapel.bind(null, conta.id),
          alternarAcesso: alternarAcesso.bind(null, conta.id),
          reenviarConvite: reenviarConvite.bind(null, conta.id),
          convidarMembro: convidarMembro.bind(null, conta.id),
        }}
      />
    </Card>
  )
}
