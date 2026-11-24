import type { Metadata } from 'next'
import { INVITE_INVALID_MESSAGE, readInvite } from '@/server/auth/invites'
import { EntryScreen } from '@/ui/shells'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { GoogleButton, LinkButton } from '@/ui/components'
import { um } from '@/app/_lib/params'
import { GoogleAviso, GoogleOu } from '@/app/app/google/GoogleAviso'
import { isGoogleConfigured } from '@/server/domain/platform/google-settings'
import { definirSenha } from './actions'
import { DefinirSenhaForm } from './DefinirSenhaForm'

// O token está na URL: nada de indexar nem de mandar o endereço a outros sites.
export const metadata: Metadata = {
  title: 'Ativar acesso | Agenda Flui',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const MARCA = { name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }
const TEMA = deriveTheme(AGENDAFLUI_BRAND)

/** Tela do convite da equipe: cria a senha e entra. Ainda não há loja escolhida, então vale a marca Agenda Flui. */
export default async function ConvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params
  const googleCode = um((await searchParams).google)
  const google = await isGoogleConfigured()
  const convite = await readInvite(token, new Date())
  if (!convite) {
    return (
      <EntryScreen theme={TEMA} brand={MARCA} headline="A agenda que flui." title="Convite sem validade" message={INVITE_INVALID_MESSAGE} testId="convite-invalido">
        <LinkButton href="/entrar">Ir para a entrada</LinkButton>
      </EntryScreen>
    )
  }
  return (
    <EntryScreen
      theme={TEMA}
      brand={MARCA}
      headline="A agenda que flui."
      title="Ative seu acesso"
      message={`Olá, ${convite.userName.split(' ')[0]}. Crie uma senha para entrar${convite.businessName ? ` em ${convite.businessName}` : ''}.`}
      testId="convite"
    >
      <GoogleAviso codigo={googleCode} />
      <DefinirSenhaForm token={token} action={definirSenha} />
      {google ? <GoogleOu /> : null}
      <GoogleButton enabled={google} fluxo="convite" convite={token} />
    </EntryScreen>
  )
}
