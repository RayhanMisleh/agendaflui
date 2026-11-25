import type { Metadata } from 'next'
import { EntryBody } from '@/ui/shells'
import { LinkButton } from '@/ui/components'
import { esqueciASenha } from './actions'
import { EsqueciForm } from './EsqueciForm'

export const metadata: Metadata = { title: 'Esqueci a senha | Agenda Flui', robots: { index: false, follow: false } }

export default function EsqueciASenhaPage() {
  return (
    <EntryBody
      title="Esqueci a senha"
      message="Digite o e-mail da sua conta. Se ele estiver cadastrado, enviamos um link para criar uma senha nova."
      testId="esqueci-a-senha"
    >
      <EsqueciForm action={esqueciASenha} />
      <LinkButton href="/entrar" variant="ghost">
        Voltar para a entrada
      </LinkButton>
    </EntryBody>
  )
}
