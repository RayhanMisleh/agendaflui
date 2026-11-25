import type { ReactNode } from 'react'
import { readStoreVisit } from '@/server/auth/guards'
import { getStoreNiche } from '@/server/domain/settings/niche-settings'
import { ClienteShell } from '@/ui/shells'
import { carregarLoja } from '../_lib/loja'

type Props = { params: Promise<{ slug: string }>; children: ReactNode }

/**
 * A moldura da área do cliente (barra do topo e navegação), desenhada UMA vez aqui: ao navegar entre as telas o layout
 * continua de pé e só o miolo (cada página, com o seu esqueleto) troca, então o menu nunca pisca nem remonta. Só o cliente
 * logado leva a moldura; visitante, pessoa sem vínculo e loja indisponível veem a página pública, sem ela (e as páginas que
 * exigem cliente redirecionam pelo próprio guard). Gravar algo que muda a moldura chama `atualizarLoja`, que refaz o layout.
 */
export default async function AreaDoClienteLayout({ params, children }: Props) {
  const { slug } = await params
  const visit = await readStoreVisit(slug)
  if (visit.kind !== 'customer') return children
  const [loja, nicho] = await Promise.all([carregarLoja(slug), getStoreNiche(visit.ctx)])
  if (!loja) return children
  return (
    <ClienteShell
      store={{ name: loja.brand.name, logoUrl: loja.brand.logoUrl, symbolUrl: loja.brand.symbolUrl, slug }}
      pets={nicho.petNiche}
      person={{ name: visit.person.name }}
    >
      {children}
    </ClienteShell>
  )
}
