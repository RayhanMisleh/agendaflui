import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ChoiceCard, PetIllustration } from '@/ui/components'
import type { PetDoFluxo } from '../tipos'
import { Passo } from './Passo'

/** Para qual pet? Gato com gatos desligados aparece desabilitado com o motivo; "Adicionar pet" abre o quiz e volta aqui. */
export function PassoPet({ slug, pets, petId, onEscolher }: { slug: string; pets: PetDoFluxo[]; petId: string | null; onEscolher: (id: string) => void }) {
  return (
    <Passo id="pet" title="Para qual pet?">
      <div className="af-cl-choices" role="radiogroup" aria-label="Pet">
        {pets.map((p) => (
          <ChoiceCard
            key={p.id}
            type="radio"
            name="pet"
            value={p.id}
            checked={petId === p.id}
            onChange={() => onEscolher(p.id)}
            title={p.name}
            detail={p.rangeLabel ? `${p.typeLabel} · ${p.rangeLabel}` : p.typeLabel}
            disabled={!p.bookable}
            disabledReason="A loja não atende gatos no momento"
            media={
              p.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a foto vem do armazenamento da conta; sem otimização aqui
                <img src={p.photoUrl} alt="" className="af-cl-flow__pet" />
              ) : (
                <span className="af-cl-flow__pet">
                  <PetIllustration variant={p.variant} size={36} />
                </span>
              )
            }
          />
        ))}
      </div>
      <Link href={`/${slug}/boas-vindas?novo=1&volta=${encodeURIComponent(`/${slug}/agendar`)}`} className="af-cl-flow__add">
        <Plus size={18} aria-hidden="true" />
        Adicionar pet
      </Link>
    </Passo>
  )
}
