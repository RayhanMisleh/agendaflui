import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { listAdmins } from '@/server/domain/platform/admins'
import { LinkButton } from '@/ui/components'
import { DevFrame } from '../DevFrame'
import { quando } from '../_lib/format'
import { AdminsPanel } from './AdminsPanel'
import { criarAdmin, desativarAdmin, reativarAdmin } from './actions'

export const metadata: Metadata = { title: 'Admins | AgendaFlui' }

export default async function AdminsPage() {
  const admin = await requirePlatformAdmin()
  const lista = await listAdmins(admin)
  const admins = lista.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    active: a.active,
    voce: a.id === admin.adminId,
    ultimoAcesso: a.lastLoginAt ? quando(a.lastLoginAt) : null,
    criadoEm: quando(a.createdAt),
    alternar: (a.active ? desativarAdmin : reativarAdmin).bind(null, a.id),
  }))
  return (
    <DevFrame admin={admin} title="Admins" actions={<LinkButton href="/perfil">Meu perfil</LinkButton>}>
      <AdminsPanel criar={criarAdmin} admins={admins} />
    </DevFrame>
  )
}
