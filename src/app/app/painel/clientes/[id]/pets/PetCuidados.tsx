'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui/components'
import { AcaoDeLinha } from '../../../_lib/AcaoDeLinha'
import type { EstadoPainel } from '../../../_lib/PainelForm'
import { arquivarPet, restaurarPet } from './actions'

const VAZIO = { ok: false, message: null, fields: {} }

/** Arquivar tira o pet das marcações e guarda o histórico; restaurar o traz de volta. */
export function PetCuidados({ customerId, petId, name, archived }: { customerId: string; petId: string; name: string; archived: boolean }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  return (
    <div className="af-careful">
      <div className="af-careful__row">
        <div className="af-careful__text">
          <span className="af-careful__title">{archived ? 'Pet arquivado' : 'Arquivar pet'}</span>
          <span className="af-careful__help">
            {archived
              ? `${name} não aparece nas marcações. Restaure para voltar a marcar horário.`
              : `${name} some das marcações. O histórico de atendimentos fica guardado e você pode restaurar depois.`}
          </span>
        </div>
        {archived ? (
          <AcaoDeLinha action={restaurarPet} campos={{ petId }} icon={<ArchiveRestore size={16} />} size="md" onDone={() => router.refresh()}>
            Restaurar pet
          </AcaoDeLinha>
        ) : (
          <Button variant="secondary" icon={<Archive size={16} />} onClick={() => setAberto(true)}>
            Arquivar pet
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title={`Arquivar ${name}?`}
        description="Ele some das marcações; o histórico fica."
        confirmLabel="Arquivar pet"
        initialState={VAZIO}
        hidden={{ petId }}
        action={async (prev, fd) => {
          const r = await arquivarPet(prev as EstadoPainel, fd)
          if (r.ok) router.push(`/painel/clientes/${customerId}`)
          return r
        }}
      />
    </div>
  )
}
