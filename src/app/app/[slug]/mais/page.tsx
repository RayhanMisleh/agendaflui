import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireCustomer } from '@/server/auth/guards'
import { maisItems } from '@/ui/shells'
import { ClienteFrame, modulosDaLoja } from '../_lib/ClienteFrame'
import { metadataDaLoja } from '../_lib/loja'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Mais')
}

/** O que mora em "Mais": Prêmios e Loja (só com o módulo ligado) e Minha conta. */
export default async function MaisPage({ params }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/mais`)
  const itens = maisItems(slug, await modulosDaLoja(visit))
  return (
    <ClienteFrame visit={visit} title="Mais">
      <ul className="af-cl-menu">
        {itens.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link href={item.href} className="af-cl-menu__row">
                <span className="af-cl-menu__icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="af-cl-menu__label">{item.label}</span>
                <ChevronRight size={18} aria-hidden="true" className="af-cl-menu__chevron" />
              </Link>
            </li>
          )
        })}
      </ul>
    </ClienteFrame>
  )
}
