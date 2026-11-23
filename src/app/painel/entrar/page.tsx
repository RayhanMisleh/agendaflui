import type { Metadata } from 'next'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { um } from '@/app/_lib/params'
import { PainelEntrada } from './PainelEntrada'

export const metadata: Metadata = { title: 'Entrar | Agenda Flui' }

const MARCA_PADRAO = {
  name: 'Agenda Flui',
  logoUrl: null,
  symbolUrl: null,
  loginImageUrl: null,
  platform: true,
  theme: deriveTheme(AGENDAFLUI_BRAND),
}

/** Entrada única da equipe: sempre com a marca Agenda Flui. */
export default async function EntrarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const senhaNova = um((await searchParams).senha) === 'nova'
  return <PainelEntrada marca={MARCA_PADRAO} senhaNova={senhaNova} />
}
