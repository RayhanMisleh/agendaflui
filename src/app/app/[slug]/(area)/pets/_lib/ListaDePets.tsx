import Link from 'next/link'
import { CalendarPlus, Plus } from 'lucide-react'
import type { PetView } from '@/server/domain/pets/pets'
import { EmptyIllustration, LinkButton, PetCard } from '@/ui/components'
import { RestaurarPet } from './RestaurarPet'

export const AVISO_SEM_GATOS = 'A loja não atende gatos no momento'

/** O pet só pode ser marcado se estiver ativo e a loja atender a espécie dele. */
export function petAgendavel(pet: PetView, servesCats: boolean): boolean {
  return !pet.archived && (pet.species !== 'CAT' || servesCats)
}

/**
 * Meus pets: a grade de cartões (1 coluna até 560 px, 2 acima, 3 no computador), o botão de adicionar no topo da tela, os
 * arquivados sob demanda e o vazio que convida a adicionar o primeiro. Gato com gatos desligados continua à vista, com o aviso
 * e sem o atalho de agendar.
 */
export function ListaDePets({
  slug,
  servesCats,
  pets,
  archived,
  showArchived,
}: {
  slug: string
  servesCats: boolean
  pets: PetView[]
  archived: PetView[]
  showArchived: boolean
}) {
  if (pets.length === 0 && archived.length === 0) {
    return (
      <section className="af-cl-state af-cl-state--inline" aria-labelledby="pets-vazio">
        <span className="af-cl-state__art">
          <EmptyIllustration name="pets" size={96} />
        </span>
        <h2 id="pets-vazio" className="af-cl-state__title">
          Nenhum pet ainda
        </h2>
        <p className="af-cl-state__text">Conte sobre o seu pet para agendar em segundos.</p>
        <LinkButton href={`/${slug}/boas-vindas?novo=1`} variant="primary" size="lg" icon={<Plus size={18} />}>
          Adicionar pet
        </LinkButton>
      </section>
    )
  }
  return (
    <>
      {pets.length === 0 ? (
        <section className="af-cl-state af-cl-state--inline" aria-labelledby="pets-vazio">
          <span className="af-cl-state__art">
            <EmptyIllustration name="pets" size={96} />
          </span>
          <h2 id="pets-vazio" className="af-cl-state__title">
            Nenhum pet ativo
          </h2>
          <LinkButton href={`/${slug}/boas-vindas?novo=1`} variant="primary" size="lg" icon={<Plus size={18} />}>
            Adicionar pet
          </LinkButton>
        </section>
      ) : (
        <ul className="af-cl-pets">
          {pets.map((p) => {
            const agenda = petAgendavel(p, servesCats)
            return (
              <li key={p.id} className="af-cl-pets__item">
                <PetCard
                  pet={p}
                  href={`/${slug}/pets/${p.id}`}
                  actions={
                    agenda ? (
                      <LinkButton href={`/${slug}/agendar?pet=${p.id}`} variant="secondary" size="sm" icon={<CalendarPlus size={16} />}>
                        Agendar
                      </LinkButton>
                    ) : null
                  }
                />
                {agenda ? null : <p className="af-cl-pets__note">{AVISO_SEM_GATOS}</p>}
              </li>
            )
          })}
        </ul>
      )}
      {archived.length > 0 ? (
        <div className="af-cl-pets__more">
          <Link href={showArchived ? `/${slug}/pets` : `/${slug}/pets?arquivados=1`} className="af-cl-saldo__link">
            {showArchived ? 'Esconder arquivados' : `Ver arquivados (${archived.length})`}
          </Link>
        </div>
      ) : null}
      {showArchived && archived.length > 0 ? (
        <section aria-labelledby="pets-arquivados">
          <h2 id="pets-arquivados" className="af-cl-section">
            Arquivados
          </h2>
          <ul className="af-cl-pets">
            {archived.map((p) => (
              <li key={p.id} className="af-cl-pets__item">
                <PetCard pet={p} actions={<RestaurarPet slug={slug} petId={p.id} />} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
