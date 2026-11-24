'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button, ConfirmDialog } from '@/ui/components'
import type { EstadoCliente } from '../../_lib/estado'
import { cancelarHorario } from '../actions'

const VAZIO = { ok: false, message: null, fields: {} }

/** "Cancelar horário" com a confirmação em folha; "Manter horário" fecha sem mudar nada. */
export function CancelarHorario({ slug, appointmentId, petName, variant = 'secondary' }: { slug: string; appointmentId: string; petName: string | null; variant?: 'secondary' | 'ghost' }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <Button variant={variant} icon={<X size={16} />} onClick={() => setAberto(true)}>
        Cancelar horário
      </Button>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title="Cancelar horário"
        description={petName ? `Cancelar o horário de ${petName}?` : 'Cancelar este horário?'}
        confirmLabel="Cancelar horário"
        initialState={VAZIO}
        hidden={{ appointmentId }}
        action={(prev, fd) => cancelarHorario(slug, prev as EstadoCliente, fd)}
        cancelLabel="Manter horário"
      />
    </>
  )
}
