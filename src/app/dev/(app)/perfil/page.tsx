import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getOwnProfile } from '@/server/domain/platform/admins'
import { DevFrame } from '../DevFrame'
import { ProfileForms } from './ProfileForms'
import { salvarPerfil, trocarSenha } from './actions'

export const metadata: Metadata = { title: 'Meu perfil | AgendaFlui' }

export default async function PerfilPage() {
  const admin = await requirePlatformAdmin()
  let eu: Awaited<ReturnType<typeof getOwnProfile>>
  try {
    eu = await getOwnProfile(admin)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  return (
    <DevFrame admin={admin} title="Meu perfil">
      <ProfileForms nome={eu.name} email={eu.email} salvar={salvarPerfil} trocar={trocarSenha} />
    </DevFrame>
  )
}
