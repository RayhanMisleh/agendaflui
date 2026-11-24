import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { storeTheme } from '@/shared/theme/store-theme'
import { ToastProvider } from '@/ui/components'
import { ThemeScope } from '@/ui/theme/ThemeScope'
import { TEMA_ENTRADA } from '@/app/app/_lib/marca'
import { carregarLoja, metadataDaLoja } from './_lib/loja'

type Props = { params: Promise<{ slug: string }>; children: ReactNode }

/** Título e ícone da loja na aba; páginas que têm título próprio (Entrar, Criar conta) o trocam. */
export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  return metadataDaLoja((await params).slug)
}

/**
 * Toda a área da loja (`/<slug>/**`) vive no tema dela: a cor da loja com o contraste conferido (se algum par falhar, o tema
 * Agenda Flui inteiro). O escopo envolve as páginas e os `loading.tsx`, então o esqueleto já sai nas cores da loja. Loja
 * indisponível usa a marca Agenda Flui. O layout não roda de novo a cada navegação: cada página e ação confere a visita.
 */
export default async function LojaLayout({ params, children }: Props) {
  const { slug } = await params
  const loja = await carregarLoja(slug)
  const tema = loja ? storeTheme(loja.brand.theme).theme : TEMA_ENTRADA
  return (
    <ThemeScope theme={tema}>
      <ToastProvider>{children}</ToastProvider>
    </ThemeScope>
  )
}
