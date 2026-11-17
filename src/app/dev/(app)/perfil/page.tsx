import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { listAdmins } from '@/server/domain/platform/admins'
import { DevFrame } from '../DevFrame'
import { ProfileForms } from './ProfileForms'
import { salvarPerfil, trocarSenha } from './actions'

export const metadata: Metadata = { title: 'Meu perfil | AgendaFlui' }

export default async function PerfilPage() {
  const admin = await requirePlatformAdmin()
  const eu = (await listAdmins(admin)).find((a) => a.id === admin.adminId)
  return (
    <DevFrame admin={admin} title="Meu perfil">
      <ProfileForms nome={eu?.name ?? admin.name} email={eu?.email ?? ''} salvar={salvarPerfil} trocar={trocarSenha} />
    </DevFrame>
  )
}
