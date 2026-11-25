import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { um } from '@/app/_lib/params'
import { requireCustomer } from '@/server/auth/guards'
import { listServicesForPet } from '@/server/domain/catalog/pet-services'
import { listServices } from '@/server/domain/catalog/services'
import { z } from '@/server/domain/errors'
import { listMyPets } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { listProfessionals } from '@/server/domain/team/professionals'
import { todayIn } from '@/server/time'
import { ClientePagina } from '@/ui/shells'
import { metadataDaLoja } from '../../_lib/loja'
import { AgendarFluxo } from './AgendarFluxo'
import type { PetDoFluxo } from './tipos'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Agendar')
}

const uuid = z.uuid()

/**
 * Agendar. Loja de pet shop sem pet leva ao quiz (e volta aqui). A pré-seleção (`?pet=&servicos=&profissional=`, de "Agendar
 * de novo" e dos cartões de pet) só vale para o que é deste cliente e é oferecido ao pet: o resto é ignorado.
 */
export default async function AgendarPage({ params, searchParams }: Props) {
  const { slug } = await params
  const sp = await searchParams
  const visit = await requireCustomer(slug, `/${slug}/agendar`)
  const { ctx } = visit
  const nicho = await getNicheSettings(ctx)
  const meus = nicho.niche === null ? [] : await listMyPets(ctx)
  if (nicho.niche !== null && meus.length === 0) return redirect(`/${slug}/boas-vindas?volta=${encodeURIComponent(`/${slug}/agendar`)}`)

  const pets: PetDoFluxo[] = meus.map((p) => ({
    id: p.id,
    name: p.name,
    typeLabel: p.typeLabel,
    rangeLabel: p.rangeLabel,
    variant: p.variant,
    photoUrl: p.photoUrl,
    bookable: p.species !== 'CAT' || nicho.options.servesCats,
  }))
  const pedidoPet = um(sp.pet)
  const petId = pets.find((p) => p.id === pedidoPet && p.bookable)?.id ?? (pets.filter((p) => p.bookable).length === 1 ? (pets.find((p) => p.bookable)?.id ?? null) : null)

  // Serviços pedidos que existem para este pet (e só entre os que ele pode receber).
  const pedidos = um(sp.servicos).split(',').filter((id) => uuid.safeParse(id).success).slice(0, 10)
  let serviceIds: string[] = []
  if (pedidos.length > 0 && (nicho.niche === null || petId !== null)) {
    const ofertados = nicho.niche === null ? (await listServices(ctx)).map((s) => s.id) : (await listServicesForPet(ctx, petId ?? '')).filter((o) => o.offered).map((o) => o.service.id)
    serviceIds = pedidos.filter((id) => ofertados.includes(id))
  }
  let professionalId: string | null | undefined
  let single = false
  if (serviceIds.length > 0) {
    const quem = await listProfessionals(ctx, { serviceIds })
    const pedido = um(sp.profissional)
    if (quem.length === 1 && quem[0]) {
      single = true
      professionalId = quem[0].id
    } else if (pedido !== '' && quem.some((x) => x.id === pedido)) {
      professionalId = pedido
    }
  }

  return (
    <ClientePagina title="Agendar" hideTitle>
      <AgendarFluxo
        slug={slug}
        today={todayIn(ctx.timeZone, ctx.clock())}
        pets={pets}
        modo="novo"
        inicial={{ petId, serviceIds, ...(professionalId !== undefined ? { professionalId } : {}), singleProfessional: single }}
      />
    </ClientePagina>
  )
}
