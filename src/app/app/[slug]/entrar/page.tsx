import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EntryScreen } from '@/ui/shells'
import { readPersonSession } from '@/server/auth/guards'
import { storeRelation } from '@/server/auth/store-join'
import { LoginForm } from '@/app/_lib/LoginForm'
import { AbasEntrada } from '../_lib/AbasEntrada'
import { LojaIndisponivel } from '../_lib/LojaIndisponivel'
import { carregarLoja, marcaDaLoja, metadataDaLoja } from '../_lib/loja'
import { entrarNaLoja } from './actions'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Entrar')
}

export default async function EntrarNaLojaPage({ params }: Props) {
  const { slug } = await params
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
      <LoginForm action={entrarNaLoja} forgotHref="/esqueci-a-senha" hidden={{ slug }} />
    </EntryScreen>
  )
}
