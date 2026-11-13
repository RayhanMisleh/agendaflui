import { EntryScreen } from '@/ui/shells'
import type { ThemeTokens } from '@/ui/theme/derive'
import { loginMember } from './actions'
import { LoginForm } from './LoginForm'

type Marca = {
  name: string
  logoUrl: string | null
  symbolUrl: string | null
  loginImageUrl: string | null
  loginMessage: string | null
  theme: ThemeTokens
}

/** A tela de entrada do painel do negócio, com a marca que a página escolheu. */
export function PainelEntrada({ marca }: { marca: Marca }) {
  return (
    <EntryScreen
      theme={marca.theme}
      brand={marca}
      title="Entrar na agenda"
      message={marca.loginMessage}
      testId="painel-entry"
    >
      <LoginForm action={loginMember} />
    </EntryScreen>
  )
}
