import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EntryScreen } from '@/ui/shells'
import { readPersonSession } from '@/server/auth/guards'
import { storeRelation } from '@/server/auth/store-join'
import { um } from '@/app/_lib/params'
import { GoogleAviso, GoogleOu } from '@/app/app/google/GoogleAviso'
import { isGoogleConfigured } from '@/server/domain/platform/google-settings'
import { GoogleButton } from '@/ui/components'
import { AbasEntrada } from '../_lib/AbasEntrada'
import { LojaIndisponivel } from '../_lib/LojaIndisponivel'
import { carregarLoja, marcaDaLoja, metadataDaLoja } from '../_lib/loja'
import { CadastroForm } from './CadastroForm'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Criar conta')
}

export default async function CadastroPage({ params, searchParams }: Props) {
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
      title="Criar conta"
      message="Crie sua conta em um minuto. Enviamos um código para confirmar o seu e-mail."
      testId="loja-cadastro"
    >
      <AbasEntrada slug={slug} />
      <GoogleAviso codigo={googleCode} />
      <GoogleButton enabled={google} fluxo="loja" slug={slug} />
      {google ? <GoogleOu /> : null}
      <CadastroForm slug={slug} />
    </EntryScreen>
  )
}
