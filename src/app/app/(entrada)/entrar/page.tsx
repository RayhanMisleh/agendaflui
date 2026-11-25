import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { destinationFor, destinationPath } from '@/server/auth/destination'
import { readPersonSession } from '@/server/auth/guards'
import { isGoogleConfigured } from '@/server/domain/platform/google-settings'
import { um } from '@/app/_lib/params'
import { Entrada } from './Entrada'

export const metadata: Metadata = { title: 'Entrar | Agenda Flui' }

/** Entrada geral da plataforma: sempre com a marca Agenda Flui. Quem já tem sessão segue para o destino dela. */
export default async function EntrarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await readPersonSession()
  if (session) {
    redirect(destinationPath(await destinationFor(session)))
  }
  const params = await searchParams
  const senhaNova = um(params.senha) === 'nova'
  return <Entrada senhaNova={senhaNova} contaExcluida={um(params.conta) === 'excluida'} googleEnabled={await isGoogleConfigured()} googleCode={um(params.google)} />
}
