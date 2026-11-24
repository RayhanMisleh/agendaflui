import type { Metadata } from 'next'
import { EntryScreen } from '@/ui/shells'
import { LinkButton } from '@/ui/components'
import { MARCA_ENTRADA, TEMA_ENTRADA } from '@/app/app/_lib/marca'
import { esqueciASenha } from './actions'
import { EsqueciForm } from './EsqueciForm'

export const metadata: Metadata = { title: 'Esqueci a senha | Agenda Flui', robots: { index: false, follow: false } }

export default function EsqueciASenhaPage() {
  return (
    <EntryScreen
      theme={TEMA_ENTRADA}
      brand={MARCA_ENTRADA}
      headline="A agenda que flui."
      title="Esqueci a senha"
      message="Digite o e-mail da sua conta. Se ele estiver cadastrado, enviamos um link para criar uma senha nova."
      testId="esqueci-a-senha"
    >
      <EsqueciForm action={esqueciASenha} />
      <LinkButton href="/entrar" variant="ghost">
        Voltar para a entrada
      </LinkButton>
    </EntryScreen>
  )
}
