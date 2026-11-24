'use client'
import { useActionState } from 'react'
import { Button, Card, StatusBadge } from '@/ui/components'
import { trocarLoja } from '../actions'
import { ESTADO_CONTA } from '../_lib/estado'
import { Retorno } from './Retorno'

type Loja = { businessId: string; slug: string; name: string; current: boolean }

function Linha({ loja }: { loja: Loja }) {
  const [state, action, pending] = useActionState(trocarLoja, ESTADO_CONTA)
  return (
    <li className="af-conta__store" data-current={loja.current}>
      <span className="af-conta__value">{loja.name}</span>
      {loja.current ? (
        <StatusBadge tone="confirmed">Loja atual</StatusBadge>
      ) : (
        <form action={action}>
          <input type="hidden" name="businessId" value={loja.businessId} />
          <Button type="submit" variant="secondary" loading={pending}>
            Ir para a loja
          </Button>
        </form>
      )}
      <Retorno state={state} />
    </li>
  )
}

/** "Suas lojas" (cliente de duas ou mais): a atual marcada e a troca com um toque. */
export function LojasSecao({ stores }: { stores: Loja[] }) {
  return (
    <Card as="section" aria-labelledby="conta-lojas" className="af-conta__card">
      <h2 id="conta-lojas" className="af-section__title">
        Suas lojas
      </h2>
      <ul className="af-conta__list">
        {stores.map((l) => (
          <Linha key={l.businessId} loja={l} />
        ))}
      </ul>
    </Card>
  )
}
