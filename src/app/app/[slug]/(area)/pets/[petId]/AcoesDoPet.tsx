'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { Button, ConfirmDialog, useToast } from '@/ui/components'
import type { EstadoCliente } from '../../../_lib/estado'
import { arquivarPet } from '../actions'

const VAZIO = { ok: false, message: null, fields: {} }

/** Arquivar tira o pet do Agendar e guarda o histórico; volta à lista com o aviso. */
export function AcoesDoPet({ slug, petId, name }: { slug: string; petId: string; name: string }) {
  const router = useRouter()
  const avisar = useToast()
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <Button variant="ghost" icon={<Archive size={16} />} onClick={() => setAberto(true)}>
        Arquivar pet
      </Button>
      <ConfirmDialog
        open={aberto}
        onClose={() => setAberto(false)}
        title={`Arquivar ${name}?`}
        description="Ele some do Agendar; o histórico fica."
        confirmLabel="Arquivar pet"
        initialState={VAZIO}
        hidden={{ petId }}
        action={async (prev, fd) => {
          const r = await arquivarPet(slug, prev as EstadoCliente, fd)
          if (r.ok) {
            avisar({ tone: 'success', message: r.message ?? `${name} arquivado.` })
            router.push(`/${slug}/pets`)
          }
          return r
        }}
      />
    </>
  )
}
