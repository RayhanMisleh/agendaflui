'use client'
import { startTransition, useActionState, useState } from 'react'
import { Card, Switch } from '@/ui/components'
import { salvarAvisosDaLoja } from '../actions'
import { ESTADO_CONTA } from '../_lib/estado'
import { Retorno } from './Retorno'

/** "Avisos da loja" (dono e gerente): recebe por e-mail os avisos de todos os agendamentos, não só os seus. */
export function AvisosSecao({ businessName, watchAll }: { businessName: string; watchAll: boolean }) {
  const [state, action, pending] = useActionState(salvarAvisosDaLoja, ESTADO_CONTA)
  const [ligado, setLigado] = useState(watchAll)
  const [visto, setVisto] = useState(state)
  // Resposta com erro desfaz a chave (o servidor não gravou); com sucesso vale o valor devolvido.
  if (visto !== state) {
    setVisto(state)
    if (state.ok) setLigado(state.values['value'] === 'on')
    else if (state.message) setLigado(watchAll)
  }
  const mudar = (proximo: boolean): void => {
    setLigado(proximo)
    const fd = new FormData()
    fd.set('value', proximo ? 'on' : '')
    startTransition(() => action(fd))
  }
  return (
    <Card as="section" aria-labelledby="conta-avisos" className="af-conta__card">
      <h2 id="conta-avisos" className="af-section__title">
        Avisos da loja
      </h2>
      <p className="af-conta__muted">{businessName}</p>
      <Retorno state={state} />
      <Switch checked={ligado} onCheckedChange={mudar} disabled={pending} label="Receber por e-mail os avisos de todos os agendamentos da loja" />
    </Card>
  )
}
