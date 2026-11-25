import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CalendarPlus } from 'lucide-react'
import { porCodigo, um } from '@/app/_lib/params'
import { requireCustomer } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getPet } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { AvatarUpload, Card, LinkButton, PetIllustration } from '@/ui/components'
import { ClientePagina } from '@/ui/shells'
import { metadataDaLoja } from '../../../_lib/loja'
import { AVISO_SEM_GATOS, petAgendavel } from '../_lib/ListaDePets'
import { FOTO } from '../_lib/foto-textos'
import { RestaurarPet } from '../_lib/RestaurarPet'
import { AcoesDoPet } from './AcoesDoPet'
import { PetEditForm } from './PetEditForm'

type Props = { params: Promise<{ slug: string; petId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Pet')
}


/** A ficha do pet: foto, dados editáveis, atalho de agendar e arquivar. O pet de outro cliente não existe aqui (404). */
export default async function PetPage({ params, searchParams }: Props) {
  const { slug, petId } = await params
  const visit = await requireCustomer(slug, `/${slug}/pets/${petId}`)
  const nicho = await getNicheSettings(visit.ctx)
  if (nicho.niche === null) return redirect(`/${slug}`)
  const pet = await getPet(visit.ctx, petId).catch((err: unknown) => {
    if (err instanceof DomainError && err.code === 'not_found') return notFound()
    throw err
  })
  const servesCats = nicho.options.servesCats
  const agenda = petAgendavel(pet, servesCats)
  const foto = porCodigo(FOTO, um((await searchParams).foto))
  return (
    <ClientePagina title={pet.name} back={{ href: `/${slug}/pets`, label: 'Meus pets' }}>
      <div className="af-cl-pet">
        <div className="af-cl-pet__head">
          <span className="af-cl-pet__photo" aria-hidden="true">
            {pet.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a foto vem do armazenamento da conta; sem otimização aqui
              <img src={pet.photoUrl} alt="" />
            ) : (
              <PetIllustration variant={pet.variant} size={48} />
            )}
          </span>
          <div>
            <p className="af-cl-pet__type">{pet.rangeLabel ? `${pet.typeLabel} · ${pet.rangeLabel}` : pet.typeLabel}</p>
            {pet.ageLabel ? <p className="af-cl-pet__type">{pet.ageLabel}</p> : null}
          </div>
        </div>
        {foto ? (
          <p role={foto.ok ? 'status' : 'alert'} className={foto.ok ? 'af-cl-notice af-cl-notice--ok' : 'af-cl-notice'}>
            {foto.texto}
          </p>
        ) : null}
        {pet.archived ? (
          <Card variant="tint" className="af-cl-pet__danger">
            <p>{pet.name} está arquivado e não aparece no Agendar.</p>
            <RestaurarPet slug={slug} petId={pet.id} />
          </Card>
        ) : (
          <>
            {agenda ? (
              <LinkButton href={`/${slug}/agendar?pet=${pet.id}`} variant="primary" size="lg" icon={<CalendarPlus size={18} />}>
                {`Agendar para ${pet.name}`}
              </LinkButton>
            ) : (
              <p className="af-cl-pets__note">{AVISO_SEM_GATOS}</p>
            )}
            <AvatarUpload action={`/${slug}/pets/${pet.id}/foto`} name={pet.name} src={pet.photoUrl} />
            <PetEditForm
              slug={slug}
              servesCats={servesCats}
              pet={{ id: pet.id, name: pet.name, species: pet.species, size: pet.size, breed: pet.breed, birthMonth: pet.birthMonth, coat: pet.coat, careNotes: pet.careNotes }}
            />
            <div className="af-cl-pet__danger">
              <AcoesDoPet slug={slug} petId={pet.id} name={pet.name} />
            </div>
          </>
        )}
      </div>
    </ClientePagina>
  )
}
