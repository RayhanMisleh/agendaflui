import { EntryBody } from '@/ui/shells'
import { entrar } from './actions'
import { LoginForm } from '@/app/_lib/LoginForm'
import { GoogleAviso, GoogleOu } from '@/app/app/google/GoogleAviso'
import { GoogleButton } from '@/ui/components'

/** O cartão da entrada geral (a moldura com a marca Agenda Flui vem do layout). */
export function Entrada({
  senhaNova = false,
  contaExcluida = false,
  googleEnabled = false,
  googleCode = '',
}: {
  senhaNova?: boolean
  contaExcluida?: boolean
  googleEnabled?: boolean
  googleCode?: string
}) {
  return (
    <EntryBody
      title="Entrar"
      message={contaExcluida ? 'Sua conta foi excluída.' : senhaNova ? 'Senha nova salva. Entre com ela.' : 'Use o e-mail e a senha da sua conta.'}
      testId="app-entry"
    >
      <GoogleAviso codigo={googleCode} />
      <GoogleButton enabled={googleEnabled} fluxo="entrar" />
      {googleEnabled ? <GoogleOu /> : null}
      <LoginForm action={entrar} forgotHref="/esqueci-a-senha" />
    </EntryBody>
  )
}
