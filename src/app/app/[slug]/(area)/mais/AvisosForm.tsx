'use client'
import { startTransition, useActionState, useState } from 'react'
import { Switch } from '@/ui/components'
import { ESTADO_VAZIO } from '../../_lib/estado'
import { salvarAvisos } from './actions'

/** "Avisos por e-mail": cada chave grava na hora; erro desfaz a chave e diz o que fazer. */
export function AvisosForm({ slug, emailAppointments, emailMarketing }: { slug: string; emailAppointments: boolean; emailMarketing: boolean }) {
  const [state, action, pending] = useActionState(salvarAvisos.bind(null, slug), ESTADO_VAZIO)
  const [valores, setValores] = useState({ emailAppointments, emailMarketing })
  const [visto, setVisto] = useState(state)
  // Resposta com erro desfaz a chave (o servidor não gravou); com sucesso vale o que foi enviado.
  if (visto !== state) {
    setVisto(state)
    if (!state.ok && state.message) setValores({ emailAppointments, emailMarketing })
  }
  function mudar(proximo: Partial<typeof valores>) {
    const novo = { ...valores, ...proximo }
    setValores(novo)
    const fd = new FormData()
    if (novo.emailAppointments) fd.set('emailAppointments', 'on')
    if (novo.emailMarketing) fd.set('emailMarketing', 'on')
    startTransition(() => action(fd))
  }
  return (
    <div className="af-cl-avisos">
      <Switch checked={valores.emailAppointments} onCheckedChange={(v) => mudar({ emailAppointments: v })} disabled={pending} label="Lembretes e mudanças dos seus horários" />
      <Switch checked={valores.emailMarketing} onCheckedChange={(v) => mudar({ emailMarketing: v })} disabled={pending} label="Novidades da loja" />
      <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'af-cl-avisos__ok' : 'af-cl-quiz__error'} hidden={!state.message}>
        {state.message}
      </p>
    </div>
  )
}
