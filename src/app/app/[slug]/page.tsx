import type { Metadata } from 'next'
import { LinkButton } from '@/ui/components'
import { EntryScreen } from '@/ui/shells'
import { readPersonSession } from '@/server/auth/guards'
import { storeRelation } from '@/server/auth/store-join'
import { LOJA_DESATIVADA } from './actions'
import { LojaIndisponivel } from './_lib/LojaIndisponivel'
import { UsarMinhaConta } from './_lib/UsarMinhaConta'
import { carregarLoja, marcaDaLoja, metadataDaLoja } from './_lib/loja'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug)
}

/** Página provisória da área do cliente: diz o que a pessoa pode fazer na loja agora (a área completa vem nas próximas fases). */
export default async function LojaPage({ params }: Props) {
  const { slug } = await params
  const loja = await carregarLoja(slug)
  if (!loja) return <LojaIndisponivel />
  const session = await readPersonSession()
  const pessoa = session?.kind === 'person' ? session : null
  const relacao = await storeRelation(pessoa?.user.id ?? null, loja.ref.businessId)

  let message = 'Entre ou crie sua conta para agendar assim que a área do cliente abrir.'
  let corpo: React.ReactNode = (
    <div className="af-entry__actions">
      <LinkButton href={`/${slug}/entrar`} variant="primary" size="lg">
        Entrar
      </LinkButton>
      <LinkButton href={`/${slug}/cadastro`} variant="secondary" size="lg">
        Criar conta
      </LinkButton>
    </div>
  )
  if (pessoa) {
    if (relacao.blocked) {
      message = LOJA_DESATIVADA
      corpo = null
    } else if (relacao.isCustomer) {
      message = 'Você já é cliente desta loja.'
      corpo = null
    } else {
      message = `Você entrou como ${pessoa.user.name}.`
      corpo = <UsarMinhaConta slug={slug} />
    }
  }
  return (
    <EntryScreen theme={loja.brand.theme} brand={marcaDaLoja(loja.brand)} headline={loja.brand.name} title="Em breve a área do cliente" message={message} testId="loja-home">
      {corpo}
      {pessoa || relacao.isStaff ? (
        <div className="af-entry__actions">
          {relacao.isStaff ? (
            <LinkButton href="/painel" variant="secondary" size="lg">
              Abrir painel
            </LinkButton>
          ) : null}
          {pessoa ? (
            <LinkButton href="/conta" variant="ghost" size="lg">
              Minha conta
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </EntryScreen>
  )
}
