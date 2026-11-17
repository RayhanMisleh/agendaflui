import { EntryScreen } from '@/ui/shells'
import type { ThemeTokens } from '@/ui/theme/derive'
import { loginMember } from './actions'
import { LoginForm } from '@/app/_lib/LoginForm'

type Marca = {
  name: string
  logoUrl: string | null
  symbolUrl: string | null
  loginImageUrl: string | null
  loginMessage: string | null
  platform?: boolean
  theme: ThemeTokens
}

/** A tela de entrada do painel do negócio, com a marca que a página escolheu. */
export function PainelEntrada({ marca }: { marca: Marca }) {
  return (
    <EntryScreen
      theme={marca.theme}
      brand={marca}
      // O nome (ou a logo) da conta já está no topo do bloco: a frase grande convida a entrar e a mensagem da conta vem embaixo, sem repetir o nome nem a saudação dela.
      headline={marca.platform ? 'A agenda que flui.' : 'Veja como está o seu dia.'}
      lede={marca.platform ? null : marca.loginMessage}
      title="Entrar na agenda"
      message="Use o e-mail e a senha da sua conta."
      testId="painel-entry"
    >
      <LoginForm action={loginMember} />
    </EntryScreen>
  )
}
