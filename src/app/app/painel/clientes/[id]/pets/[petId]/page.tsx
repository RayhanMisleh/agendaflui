import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getCustomer } from '@/server/domain/customers/customers'
import type { CustomerView } from '@/server/domain/customers/customers'
import { getPet } from '@/server/domain/pets/pets'
import type { PetView } from '@/server/domain/pets/pets'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { PET_NICHE } from '@/server/niches/pet'
import { AvatarUpload, Card, LinkButton, PetCard } from '@/ui/components'
import { um, porCodigo } from '@/app/_lib/params'
import { ShellPage } from '@/ui/shells'
import { PetCuidados } from '../PetCuidados'
import { PetForm } from '../PetForm'

export const metadata: Metadata = { title: 'Pet | Agenda Flui' }

const FOTO: Record<string, { texto: string; ok: boolean }> = {
  ok: { texto: 'Foto atualizada.', ok: true },
  no_file: { texto: 'Escolha uma imagem antes de enviar.', ok: false },
  too_large: { texto: 'A foto passa de 8 MB. Escolha um arquivo menor.', ok: false },
  not_an_image: { texto: 'Este arquivo não é uma imagem. Envie JPEG, PNG ou WebP.', ok: false },
  unsupported_format: { texto: 'Este formato não é aceito. Envie JPEG, PNG ou WebP.', ok: false },
  too_many_pixels: { texto: 'A imagem é grande demais. Reduza e envie de novo.', ok: false },
  too_small: { texto: 'A imagem é pequena demais. Escolha outra.', ok: false },
  refused: { texto: 'Você não tem permissão para trocar esta foto.', ok: false },
  not_found: { texto: 'Este pet não existe mais.', ok: false },
}

export default async function PetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; petId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireTenant('view_clients')
  const { id, petId } = await params
  const q = await searchParams

  let cliente: CustomerView
  let pet: PetView
  try {
    ;[cliente, pet] = await Promise.all([getCustomer(ctx, id), getPet(ctx, petId)])
  } catch (err) {
    if (err instanceof DomainError && (err.code === 'not_found' || err.reason === 'niche_unavailable')) notFound()
    throw err
  }
  if (pet.customerId !== cliente.id) notFound()
  const painel = await getPainelContext(ctx)
  const podeEscrever = can(ctx.actor, 'manage_clients') && !cliente.archived
  const foto = porCodigo(FOTO, um(q.foto))
  const novo = um(q.novo) === '1'

  return (
    <ShellPage
      title={pet.name}
      actions={
        <LinkButton href={`/painel/clientes/${cliente.id}`} variant="ghost">
          Voltar para {cliente.name}
        </LinkButton>
      }
    >
      <div className="af-profile af-profile--narrow">
        {novo ? (
          <p role="status" className="af-wizard__note">
            Pet adicionado. Quer pôr uma foto?
          </p>
        ) : null}
        {foto ? (
          <p role={foto.ok ? 'status' : 'alert'} className={foto.ok ? 'af-acctform__ok' : 'af-rowerror'}>
            {foto.texto}
          </p>
        ) : null}

        <Card as="section" aria-label="Resumo do pet" className="af-profile">
          <PetCard pet={pet} />
          {podeEscrever && !pet.archived ? (
            <details className="af-profile__photo" open={novo || foto !== null}>
              <summary>{pet.photoUrl ? 'Trocar a foto' : 'Adicionar foto'}</summary>
              <AvatarUpload action={`/painel/clientes/${cliente.id}/pets/${pet.id}/foto`} name={pet.name} src={pet.photoUrl} />
            </details>
          ) : null}
        </Card>

        <Card as="section" aria-labelledby="pet-dados" className="af-profile">
          <h2 id="pet-dados" className="af-section__title">
            Dados do pet
          </h2>
          {podeEscrever && !pet.archived ? (
            <PetForm
              customerId={cliente.id}
              servesCats={painel.niche?.servesCats ?? false}
              pet={{ id: pet.id, name: pet.name, species: pet.species, size: pet.size, breed: pet.breed, birthMonth: pet.birthMonth, coat: pet.coat, careNotes: pet.careNotes }}
            />
          ) : (
            <dl className="af-facts">
              <div>
                <dt>Tipo</dt>
                <dd>{pet.rangeLabel ? `${pet.typeLabel} · ${pet.rangeLabel}` : pet.typeLabel}</dd>
              </div>
              <div>
                <dt>Raça</dt>
                <dd>{pet.breed ?? 'Não informada'}</dd>
              </div>
              <div>
                <dt>Idade</dt>
                <dd>{pet.ageLabel ?? 'Não informada'}</dd>
              </div>
              <div>
                <dt>Pelagem</dt>
                <dd>{pet.coat ? PET_NICHE.coatLabels[pet.coat] : 'Não informada'}</dd>
              </div>
              <div>
                <dt>Cuidados e comportamento</dt>
                <dd>{pet.careNotes ?? 'Nenhum cuidado anotado.'}</dd>
              </div>
            </dl>
          )}
        </Card>

        {can(ctx.actor, 'manage_clients') && !cliente.archived ? (
          <Card as="section" aria-labelledby="pet-cuidados" className="af-profile">
            <h2 id="pet-cuidados" className="af-section__title">
              Cuidados com o cadastro
            </h2>
            <PetCuidados customerId={cliente.id} petId={pet.id} name={pet.name} archived={pet.archived} />
          </Card>
        ) : null}
      </div>
    </ShellPage>
  )
}
