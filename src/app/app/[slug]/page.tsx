import type { Metadata } from 'next'
import { readStoreVisit } from '@/server/auth/guards'
import { getStorefront } from '@/server/domain/storefront/storefront'
import { um } from '@/app/_lib/params'
import { safeReturnPath } from '@/shared/return-path'
import { ClienteFrame } from './_lib/ClienteFrame'
import { InicioProvisorio } from './_lib/InicioProvisorio'
import { LojaIndisponivel } from './_lib/LojaIndisponivel'
import { LojaPublica } from './_lib/LojaPublica'
import { carregarLoja, metadataDaLoja } from './_lib/loja'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug)
}

/**
 * `/<slug>`: a página pública da loja para quem não é cliente (visitante, pessoa entrada sem vínculo, conta desativada) e o
 * Início para o cliente. Abrir a página nunca cria vínculo: só "Usar minha conta" cria.
 */
export default async function LojaPage({ params, searchParams }: Props) {
  const { slug } = await params
  const visit = await readStoreVisit(slug)
  if (visit.kind === 'unavailable') return <LojaIndisponivel />
  if (visit.kind === 'customer') {
    return (
      <ClienteFrame visit={visit} title="Início" hideTitle>
        <InicioProvisorio visit={visit} />
      </ClienteFrame>
    )
  }
  const [loja, storefront] = await Promise.all([carregarLoja(slug), getStorefront(visit.ctx)])
  if (!loja) return <LojaIndisponivel />
  const volta = safeReturnPath(slug, um((await searchParams).volta))
  return (
    <LojaPublica
      slug={slug}
      brand={loja.brand}
      storefront={storefront}
      volta={volta}
      visit={visit.kind === 'anonymous' ? { kind: 'anonymous' } : { kind: 'visitor', person: visit.person, isStaff: visit.isStaff, blocked: visit.blocked }}
    />
  )
}
