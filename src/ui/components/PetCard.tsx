import type { ReactNode } from 'react'
import Link from 'next/link'
import type { PetView } from '@/server/domain/pets/pets'
import { PET_NICHE } from '@/server/niches/pet'
import { cx } from './cx'
import { PetIllustration } from './pet-illustrations'

/**
 * Cartão do pet: foto (ou o desenho do porte num círculo Bolha), nome, "Cão médio · 10 a 25 kg", raça, idade, pelagem e
 * os cuidados em até duas linhas. Com `href` o nome leva à ficha e o cartão inteiro vira alvo do toque; `actions` ficam
 * por cima (botões próprios).
 */
export function PetCard({ pet, href, actions }: { pet: PetView; href?: string; actions?: ReactNode }) {
  const tipo = pet.rangeLabel ? `${pet.typeLabel} · ${pet.rangeLabel}` : pet.typeLabel
  const detalhes = [pet.breed, pet.ageLabel, pet.coat ? `Pelo ${PET_NICHE.coatLabels[pet.coat].toLowerCase()}` : null].filter((d): d is string => d !== null && d !== '')
  return (
    <article className={cx('af-petcard', href && 'af-petcard--link', pet.archived && 'af-petcard--archived')}>
      <span className="af-petcard__photo" aria-hidden="true">
        {pet.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a foto vem do armazenamento da conta; sem otimização aqui
          <img src={pet.photoUrl} alt="" className="af-petcard__img" />
        ) : (
          <PetIllustration variant={pet.variant} size={40} />
        )}
      </span>
      <div className="af-petcard__body">
        <h3 className="af-petcard__name">
          {href ? (
            <Link href={href} className="af-petcard__link">
              {pet.name}
            </Link>
          ) : (
            pet.name
          )}
          {pet.archived ? <span className="af-petcard__tag">Arquivado</span> : null}
        </h3>
        <p className="af-petcard__type">{tipo}</p>
        {detalhes.length > 0 ? <p className="af-petcard__meta">{detalhes.join(' · ')}</p> : null}
        {pet.careNotes ? <p className="af-petcard__care">{pet.careNotes}</p> : null}
      </div>
      {actions ? <div className="af-petcard__actions">{actions}</div> : null}
    </article>
  )
}
