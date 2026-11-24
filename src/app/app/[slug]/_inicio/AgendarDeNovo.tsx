import Link from 'next/link'
import { RotateCw } from 'lucide-react'
import type { RebookSuggestion } from '@/server/domain/scheduling/customer-home'

/** "Agendar de novo": repete o último atendimento (pet, serviços e profissional) com um toque. */
export function AgendarDeNovo({ slug, rebook }: { slug: string; rebook: RebookSuggestion }) {
  const servicos = rebook.serviceNames.join(' e ')
  const quem = rebook.professionalName ?? 'qualquer profissional'
  return (
    <Link href={`/${slug}/agendar${rebook.query}`} className="af-cl-rebook">
      <span className="af-cl-rebook__label">
        <RotateCw size={16} aria-hidden="true" /> Agendar de novo
      </span>
      <span className="af-cl-rebook__what">
        {servicos}
        {rebook.petName ? ` para ${rebook.petName}` : ''} com {quem}
      </span>
    </Link>
  )
}
