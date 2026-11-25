import type { Metadata } from 'next'
import { requireCustomer } from '@/server/auth/guards'
import { getPersonAccount } from '@/server/auth/person-account'
import { ClientePagina } from '@/ui/shells'
import { metadataDaLoja } from '../../../_lib/loja'
import { ExcluirForm } from './ExcluirForm'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Excluir conta')
}

/** Excluir a conta nesta loja: o que some e a confirmação de quem pede. */
export default async function ExcluirPage({ params }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/mais/excluir`)
  const conta = await getPersonAccount(visit.person.userId, visit.store.businessId)
  return (
    <ClientePagina title="Excluir minha conta" back={{ href: `/${slug}/mais`, label: 'Mais' }}>
      <div className="af-cl-pet">
        <p>Seus dados nesta loja são apagados e os horários futuros, cancelados. Se você não usa o Agenda Flui em outra loja, sua conta também é apagada.</p>
        <ExcluirForm slug={slug} hasPassword={conta.hasPassword} />
      </div>
    </ClientePagina>
  )
}
