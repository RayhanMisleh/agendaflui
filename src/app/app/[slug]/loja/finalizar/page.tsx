import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireCustomer } from '@/server/auth/guards'
import { listAddresses } from '@/server/domain/store/addresses'
import { getStoreOptions } from '@/server/domain/store/settings'
import { ClienteFrame, modulosDaLoja } from '../../_lib/ClienteFrame'
import { ModuloDesligado } from '../../_lib/ModuloDesligado'
import { metadataDaLoja } from '../../_lib/loja'
import { readCart } from '../_lib/carrinho'
import { resumirCarrinho } from '../_lib/resumo'
import { FinalizarForm } from './FinalizarForm'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Finalizar')
}

/** Finalizar o pedido. Carrinho vazio ou com item que trava volta ao carrinho, onde os avisos explicam. */
export default async function FinalizarPage({ params }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/loja/finalizar`)
  const voltar = { href: `/${slug}/loja/carrinho`, label: 'Carrinho' }
  if (!(await modulosDaLoja(visit)).store) {
    return (
      <ClienteFrame visit={visit} title="Finalizar" back={voltar}>
        <ModuloDesligado slug={slug} what="Loja" />
      </ClienteFrame>
    )
  }
  const linhas = await readCart()
  if (linhas.length === 0) redirect(`/${slug}/loja/carrinho`)
  const resumo = await resumirCarrinho(visit.ctx, linhas)
  if (!resumo.podeContinuar) redirect(`/${slug}/loja/carrinho`)
  const [options, enderecos] = await Promise.all([getStoreOptions(visit.ctx), listAddresses(visit.ctx)])
  return (
    <ClienteFrame visit={visit} title="Finalizar" back={voltar}>
      <FinalizarForm
        slug={slug}
        options={options}
        nomeInicial={visit.person.name}
        chave={randomUUID()}
        enderecos={enderecos}
        resumo={{ linhas: resumo.itens.map((i) => ({ name: i.name, quantity: i.quantity, totalCents: i.totalCents })), itemsCents: resumo.subtotalCents }}
      />
    </ClienteFrame>
  )
}
