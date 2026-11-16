import type { Metadata } from 'next'
import { LoginForm } from '@/app/_lib/LoginForm'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { EntryScreen } from '@/ui/shells'
import { loginAdmin } from './actions'

export const metadata: Metadata = { title: 'Entrar | AgendaFlui' }

const THEME = deriveTheme(AGENDAFLUI_BRAND)

export default function EntrarPage() {
  return (
    <EntryScreen
      theme={THEME}
      variant="dev"
      brand={{ name: 'AgendaFlui', logoUrl: null, symbolUrl: null }}
      title="Entrar na mesa de controle"
      message="Acesso para quem administra a plataforma."
      testId="dev-entry"
    >
      <LoginForm action={loginAdmin} />
    </EntryScreen>
  )
}
