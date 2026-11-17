import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { Vitrine } from './Vitrine'

export const metadata: Metadata = { title: 'Vitrine da marca | Agenda Flui' }

// A vitrine é ferramenta da plataforma: só admin entra.
export default async function VitrinePage() {
  await requirePlatformAdmin()
  return <Vitrine />
}
