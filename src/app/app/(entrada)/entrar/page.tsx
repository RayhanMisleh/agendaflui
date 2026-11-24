import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { destinationFor, destinationPath } from '@/server/auth/destination'
import { readPersonSession } from '@/server/auth/guards'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { um } from '@/app/_lib/params'
import { Entrada } from './Entrada'

export const metadata: Metadata = { title: 'Entrar | Agenda Flui' }

const MARCA_PADRAO = {
  name: 'Agenda Flui',
  logoUrl: null,
  symbolUrl: null,
  loginImageUrl: null,
  platform: true,
  theme: deriveTheme(AGENDAFLUI_BRAND),
}

/** Entrada geral da plataforma: sempre com a marca Agenda Flui. Quem já tem sessão segue para o destino dela. */
export default async function EntrarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await readPersonSession()
  if (session) {
    redirect(destinationPath(await destinationFor(session)))
  }
  const senhaNova = um((await searchParams).senha) === 'nova'
  return <Entrada marca={MARCA_PADRAO} senhaNova={senhaNova} />
}
