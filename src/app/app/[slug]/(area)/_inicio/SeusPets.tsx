import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { PetView } from '@/server/domain/pets/pets'
import { PetIllustration } from '@/ui/components'

/** Os pets ativos em círculos (foto ou desenho do porte) e o "+" que abre o quiz para adicionar outro. */
export function SeusPets({ slug, pets }: { slug: string; pets: PetView[] }) {
  return (
    <section aria-labelledby="seus-pets" className="af-cl-mypets">
      <h2 id="seus-pets" className="af-cl-section">
        Seus pets
      </h2>
      <ul className="af-cl-mypets__row">
        {pets.map((p) => (
          <li key={p.id}>
            <Link href={`/${slug}/pets/${p.id}`} className="af-cl-mypets__pet">
              <span className="af-cl-mypets__photo" aria-hidden="true">
                {p.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a foto vem do armazenamento da conta; sem otimização aqui
                  <img src={p.photoUrl} alt="" />
                ) : (
                  <PetIllustration variant={p.variant} size={32} />
                )}
              </span>
              <span className="af-cl-mypets__name">{p.name}</span>
            </Link>
          </li>
        ))}
        <li>
          <Link href={`/${slug}/boas-vindas?novo=1`} className="af-cl-mypets__pet" aria-label="Adicionar pet">
            <span className="af-cl-mypets__photo af-cl-mypets__photo--add" aria-hidden="true">
              <Plus size={22} />
            </span>
            <span className="af-cl-mypets__name">Adicionar</span>
          </Link>
        </li>
      </ul>
    </section>
  )
}
