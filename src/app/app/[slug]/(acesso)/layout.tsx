import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { EntryFrame } from '@/ui/shells'
import { AbasEntrada } from '../_lib/AbasEntrada'
import { LojaIndisponivel } from '../_lib/LojaIndisponivel'
import { carregarLoja, marcaDaLoja } from '../_lib/loja'

type Props = { params: Promise<{ slug: string }>; children: ReactNode }

/**
 * Moldura de Entrar e Criar conta da loja: o bloco com a marca da loja, o cartão e as abas ficam aqui e não remontam ao
 * trocar de aba; cada página só troca o conteúdo do cartão. Loja indisponível mostra a tela própria, sem moldura.
 */
export default async function AcessoLayout({ params, children }: Props) {
  const { slug } = await params
  const loja = await carregarLoja(slug)
  if (!loja) return <LojaIndisponivel />
  return (
    <EntryFrame theme={loja.brand.theme} brand={marcaDaLoja(loja.brand)} headline={loja.brand.name}>
      <Suspense fallback={null}>
        <AbasEntrada slug={slug} />
      </Suspense>
      {children}
    </EntryFrame>
  )
}
