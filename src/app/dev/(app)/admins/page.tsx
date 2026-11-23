import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { listAdmins } from '@/server/domain/platform/admins'
import { DevFrame } from '../DevFrame'
import { HorariosNota } from '../_lib/HorariosNota'
import { quando } from '../_lib/format'
import { AdminsPanel } from './AdminsPanel'
import { criarAdmin, desativarAdmin, reativarAdmin } from './actions'

export const metadata: Metadata = { title: 'Admins | Agenda Flui' }

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
    // O domínio recusa desativar a si mesmo; a tela nem oferece (quem é você não ganha ação).
    alternar: a.id === admin.adminId ? null : (a.active ? desativarAdmin : reativarAdmin).bind(null, a.id),
  }))
  return (
    <DevFrame admin={admin} title="Admins">
      <HorariosNota />
      <AdminsPanel criar={criarAdmin} admins={admins} />
    </DevFrame>
  )
}
