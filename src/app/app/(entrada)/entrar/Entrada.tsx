import { EntryScreen } from '@/ui/shells'
import type { ThemeTokens } from '@/ui/theme/derive'
import { entrar } from './actions'
import { LoginForm } from '@/app/_lib/LoginForm'
import { GoogleAviso, GoogleOu } from '@/app/app/google/GoogleAviso'
import { GoogleButton } from '@/ui/components'

type Marca = {
  name: string
  logoUrl: string | null
  symbolUrl: string | null
  loginImageUrl: string | null
  platform?: boolean
  theme: ThemeTokens
}

/** A tela de entrada geral, com a marca Agenda Flui. */
export function Entrada({
  marca,
  senhaNova = false,
  contaExcluida = false,
  googleEnabled = false,
  googleCode = '',
}: {
  marca: Marca
  senhaNova?: boolean
  contaExcluida?: boolean
  googleEnabled?: boolean
  googleCode?: string
}) {
  return (
    <EntryScreen
      theme={marca.theme}
      brand={marca}
      headline="A agenda que flui."
      title="Entrar"
      message={contaExcluida ? 'Sua conta foi excluída.' : senhaNova ? 'Senha nova salva. Entre com ela.' : 'Use o e-mail e a senha da sua conta.'}
      testId="app-entry"
    >
      <GoogleAviso codigo={googleCode} />
      <GoogleButton enabled={googleEnabled} fluxo="entrar" />
      {googleEnabled ? <GoogleOu /> : null}
      <LoginForm action={entrar} forgotHref="/esqueci-a-senha" />
    </EntryScreen>
  )
}
