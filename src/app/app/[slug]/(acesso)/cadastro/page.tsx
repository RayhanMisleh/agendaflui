import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { readPersonSession } from '@/server/auth/guards'
import { storeRelation } from '@/server/auth/store-join'
import { um } from '@/app/_lib/params'
import { GoogleAviso, GoogleOu } from '@/app/app/google/GoogleAviso'
import { isGoogleConfigured } from '@/server/domain/platform/google-settings'
import { GoogleButton } from '@/ui/components'
import { safeReturnPath } from '@/shared/return-path'
import { carregarLoja, metadataDaLoja } from '../../_lib/loja'
import { CadastroQuiz } from './CadastroQuiz'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Criar conta')
}

export default async function CadastroPage({ params, searchParams }: Props) {
  const { slug } = await params
  const query = await searchParams
  const googleCode = um(query.google)
  const google = await isGoogleConfigured()
  const loja = await carregarLoja(slug)
  if (!loja) return null
  const volta = safeReturnPath(slug, um(query.volta))
  const session = await readPersonSession()
  if (session?.kind === 'person' && (await storeRelation(session.user.id, loja.ref.businessId)).isCustomer) redirect(volta ?? `/${slug}`)
  return (
    <CadastroQuiz
      slug={slug}
      volta={volta}
      abertura={
        <>
          <GoogleAviso codigo={googleCode} />
          <GoogleButton enabled={google} fluxo="loja" slug={slug} {...(volta ? { volta } : {})} />
          {google ? <GoogleOu /> : null}
        </>
      }
    />
  )
}
