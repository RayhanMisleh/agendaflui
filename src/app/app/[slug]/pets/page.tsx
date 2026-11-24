import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { um } from '@/app/_lib/params'
import { requireCustomer } from '@/server/auth/guards'
import { listMyPets } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { LinkButton } from '@/ui/components'
import { ClienteFrame } from '../_lib/ClienteFrame'
import { metadataDaLoja } from '../_lib/loja'
import { ListaDePets } from './_lib/ListaDePets'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Meus pets')
}

/** Meus pets: os pets do cliente, o atalho de adicionar e os arquivados sob demanda. Só existe em loja de pet shop. */
export default async function PetsPage({ params, searchParams }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/pets`)
  const nicho = await getNicheSettings(visit.ctx)
  if (nicho.niche === null) return redirect(`/${slug}`)
  const todos = await listMyPets(visit.ctx, { includeArchived: true })
  return (
    <ClienteFrame
      visit={visit}
      title="Meus pets"
      actions={
        <LinkButton href={`/${slug}/boas-vindas?novo=1`} variant="primary" icon={<Plus size={18} />}>
          Adicionar pet
        </LinkButton>
      }
    >
      <ListaDePets
        slug={slug}
        servesCats={nicho.options.servesCats}
        pets={todos.filter((p) => !p.archived)}
        archived={todos.filter((p) => p.archived)}
        showArchived={um((await searchParams).arquivados) === '1'}
      />
    </ClienteFrame>
  )
}
