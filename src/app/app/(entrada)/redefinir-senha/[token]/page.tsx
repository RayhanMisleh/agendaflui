import type { Metadata } from 'next'
import { readPasswordReset, RESET_INVALID_MESSAGE } from '@/server/auth/password-reset'
import { EntryBody } from '@/ui/shells'
import { LinkButton } from '@/ui/components'
import { redefinirSenha } from './actions'
import { RedefinirForm } from './RedefinirForm'

// O token está na URL: nada de indexar nem de mandar o endereço a outros sites.
export const metadata: Metadata = {
  title: 'Redefinir senha | Agenda Flui',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function RedefinirSenhaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await readPasswordReset(token, new Date())
  if (!link) {
    return (
      <EntryBody title="Link sem validade" message={RESET_INVALID_MESSAGE} testId="redefinir-senha-invalido">
        <LinkButton href="/esqueci-a-senha">Pedir um link novo</LinkButton>
      </EntryBody>
    )
  }
  return (
    <EntryBody
      title="Crie uma senha nova"
      message={`Escolha a senha para entrar com ${link.email}.`}
      testId="redefinir-senha"
    >
      <RedefinirForm token={token} action={redefinirSenha} />
    </EntryBody>
  )
}
