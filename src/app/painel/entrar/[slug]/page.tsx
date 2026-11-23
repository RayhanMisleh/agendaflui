import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicBrandBySlug } from '@/server/domain/platform/branding'
import { iconesDaConta } from '../../_marca'
import { PainelEntrada } from '../PainelEntrada'

type Props = { params: Promise<{ slug: string }> }

// O título não leva o nome da conta: a marca já aparece na tela e o título fica igual em todas.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const icons = iconesDaConta((await getPublicBrandBySlug((await params).slug))?.faviconUrl ?? null)
  return { title: 'Entrar | Agenda Flui', ...(icons ? { icons } : {}) }
}

/** Link de entrada de uma conta: já abre com a marca dela. */
export default async function EntrarDaContaPage({ params }: Props) {
  const marca = await getPublicBrandBySlug((await params).slug)
  if (!marca) notFound()
  return <PainelEntrada marca={marca} />
}
