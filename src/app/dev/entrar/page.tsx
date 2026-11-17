import type { Metadata } from 'next'
import { LoginForm } from '@/app/_lib/LoginForm'
import { EntryScreen } from '@/ui/shells'
import { loginAdmin } from './actions'

export const metadata: Metadata = { title: 'Entrar | AgendaFlui' }

export default function EntrarPage() {
  return (
    <EntryScreen
      variant="dev"
      brand={{ name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }}
      headline="Painel da plataforma"
      lede="Contas, chaves e sistema da Agenda Flui, num lugar só."
      title="Entrar no painel"
      message="Acesso para quem administra a plataforma."
      testId="dev-entry"
    >
      <LoginForm action={loginAdmin} />
    </EntryScreen>
  )
}
