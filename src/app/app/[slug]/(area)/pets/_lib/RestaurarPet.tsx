'use client'
import { ArchiveRestore } from 'lucide-react'
import { useToast } from '@/ui/components'
import { ClienteForm } from '../../../_lib/ClienteForm'
import { restaurarPet } from '../actions'

/** "Restaurar" de um pet arquivado: o pet volta à lista e a todas as marcações. Erro (limite de 20) aparece no cartão. */
export function RestaurarPet({ slug, petId }: { slug: string; petId: string }) {
  const avisar = useToast()
  return (
    <ClienteForm
      action={restaurarPet}
      slug={slug}
      hidden={{ petId }}
      submit="Restaurar"
      variant="secondary"
      size="sm"
      submitIcon={<ArchiveRestore size={16} />}
      onDone={(s) => avisar({ tone: 'success', message: s.message ?? 'Pet restaurado.' })}
    />
  )
}
