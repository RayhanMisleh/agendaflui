import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EntryScreen } from '@/ui/shells'
import { readPersonSession } from '@/server/auth/guards'
import { storeRelation } from '@/server/auth/store-join'
import { LoginForm } from '@/app/_lib/LoginForm'
import { um } from '@/app/_lib/params'
import { GoogleAviso, GoogleOu } from '@/app/app/google/GoogleAviso'
import { isGoogleConfigured } from '@/server/domain/platform/google-settings'
import { GoogleButton } from '@/ui/components'
import { AbasEntrada } from '../_lib/AbasEntrada'
import { LojaIndisponivel } from '../_lib/LojaIndisponivel'
import { carregarLoja, marcaDaLoja, metadataDaLoja } from '../_lib/loja'
import { entrarNaLoja } from './actions'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Entrar')
}

export default async function EntrarNaLojaPage({ params, searchParams }: Props) {
  const { slug } = await params
  const googleCode = um((await searchParams).google)
  const google = await isGoogleConfigured()
  const loja = await carregarLoja(slug)
  if (!loja) return <LojaIndisponivel />
  const session = await readPersonSession()
  if (session?.kind === 'person' && (await storeRelation(session.user.id, loja.ref.businessId)).isCustomer) redirect(`/${slug}`)
  return (
    <EntryScreen
      theme={loja.brand.theme}
      brand={marcaDaLoja(loja.brand)}
      headline={loja.brand.name}
      title="Entrar"
      message="Use o e-mail e a senha da sua conta."
      testId="loja-entrar"
    >
      <AbasEntrada slug={slug} />
      <GoogleAviso codigo={googleCode} />
      <GoogleButton enabled={google} fluxo="loja" slug={slug} />
      {google ? <GoogleOu /> : null}
      <LoginForm action={entrarNaLoja} forgotHref="/esqueci-a-senha" hidden={{ slug }} />
    </EntryScreen>
  )
}
