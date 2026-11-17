import type { Metadata } from 'next'
import { readPanelPasswordReset, RESET_INVALID_MESSAGE } from '@/server/auth/password-reset'
import { EntryScreen } from '@/ui/shells'
import { LinkButton } from '@/ui/components'
import { MARCA_ENTRADA, TEMA_ENTRADA } from '../../_marca'
import { redefinirSenha } from './actions'
import { RedefinirForm } from './RedefinirForm'

// O token está na URL: nada de indexar nem de mandar o endereço a outros sites.
export const metadata: Metadata = {
  title: 'Redefinir senha | AgendaFlui',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function RedefinirSenhaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await readPanelPasswordReset(token, new Date())
  if (!link) {
    return (
      <EntryScreen theme={TEMA_ENTRADA} brand={MARCA_ENTRADA} headline="A agenda que flui." title="Link sem validade" message={RESET_INVALID_MESSAGE} testId="redefinir-senha-invalido">
        <LinkButton href="/esqueci-a-senha">Pedir um link novo</LinkButton>
      </EntryScreen>
    )
  }
  return (
    <EntryScreen
      theme={TEMA_ENTRADA}
      brand={MARCA_ENTRADA}
      headline="A agenda que flui."
      title="Crie uma senha nova"
      message={`Escolha a senha para entrar com ${link.email}.`}
      testId="redefinir-senha"
    >
      <RedefinirForm token={token} action={redefinirSenha} />
    </EntryScreen>
  )
}
