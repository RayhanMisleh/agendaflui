import type { Metadata } from 'next'
import { requireCustomer } from '@/server/auth/guards'
import { listAddresses } from '@/server/domain/store/addresses'
import { ClientePagina } from '@/ui/shells'
import { modulosDaLoja } from '../../../_lib/modulos'
import { ModuloDesligado } from '../../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../../_lib/loja'
import { EnderecosLista } from './EnderecosLista'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Endereços')
}

/** Endereços de entrega do cliente: só os dele. */
export default async function EnderecosPage({ params }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/loja/enderecos`)
  const voltar = { href: `/${slug}/loja/pedidos`, label: 'Meus pedidos' }
  if (!(await modulosDaLoja(visit)).store) {
    return (
      <ClientePagina title="Endereços" back={voltar}>
        <ModuloDesligado slug={slug} what="Loja" />
      </ClientePagina>
    )
  }
  const enderecos = await listAddresses(visit.ctx)
  return (
    <ClientePagina title="Endereços" back={voltar}>
      <EnderecosLista slug={slug} nomeInicial={visit.person.name} enderecos={enderecos} />
    </ClientePagina>
  )
}
