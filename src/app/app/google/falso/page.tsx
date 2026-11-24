import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { env } from '@/server/env'
import { EntryScreen } from '@/ui/shells'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { simularGoogle } from './actions'
import { FalsoForm } from './FalsoForm'

export const metadata: Metadata = { title: 'Simular Google | Agenda Flui', robots: { index: false, follow: false } }

const MARCA = { name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }

/** Simula a tela de escolha de conta do Google. Só existe com `INTEGRATIONS_MODE=fake`; em produção é 404. */
export default function GoogleFalsoPage() {
  if (env.INTEGRATIONS_MODE !== 'fake') notFound()
  return (
    <EntryScreen
      theme={deriveTheme(AGENDAFLUI_BRAND)}
      brand={MARCA}
      headline="A agenda que flui."
      title="Simular Google"
      message="Tela de teste: escolha a conta Google que quer simular."
      testId="google-falso"
    >
      <FalsoForm action={simularGoogle} />
    </EntryScreen>
  )
}
