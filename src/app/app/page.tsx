import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { destinationFor, destinationPath } from '@/server/auth/destination'
import { readPersonSession } from '@/server/auth/guards'
import { SemLoja } from './_lib/SemLoja'

export const metadata: Metadata = { title: 'Agenda Flui' }

/** Raiz do endereço único: sem sessão vai para a entrada; com sessão, a função de destino decide. */
export default async function AppRaiz() {
  const session = await readPersonSession()
  if (!session) redirect('/entrar')
  const destino = await destinationFor(session)
  if (destino.kind === 'no_store') return <SemLoja />
  redirect(destinationPath(destino))
}
