'use client'
import { useActionState } from 'react'
import { Button, Card, Field, Input, MaskedInput } from '@/ui/components'
import { salvarDados } from '../actions'
import { ESTADO_CONTA } from '../_lib/estado'
import { Retorno } from './Retorno'

/** "Seus dados": nome e telefone da pessoa. Para cliente, a mudança vale em todas as lojas dela. */
export function DadosForm({ name, phoneLabel, shared }: { name: string; phoneLabel: string | null; shared: boolean }) {
  const [state, action, pending] = useActionState(salvarDados, ESTADO_CONTA)
  const f = state.fields
  return (
    <Card as="section" aria-labelledby="conta-dados" className="af-conta__card">
      <h2 id="conta-dados" className="af-section__title">
        Seus dados
      </h2>
      {shared ? <p className="af-conta__muted">Vale para todas as suas lojas.</p> : null}
      <form action={action} className="af-conta__form">
        <Retorno state={state} />
        <Field label="Nome" error={f['name']}>
          <Input name="name" autoComplete="name" required maxLength={120} defaultValue={state.values['name'] ?? name} invalid={Boolean(f['name'])} />
        </Field>
        <Field label="Telefone" hint="Com DDD. Opcional." error={f['phone']}>
          <MaskedInput mask="phone" name="phone" defaultValue={state.values['phone'] ?? phoneLabel ?? ''} invalid={Boolean(f['phone'])} />
        </Field>
        <Button type="submit" variant="primary" loading={pending}>
          Salvar dados
        </Button>
      </form>
    </Card>
  )
}
