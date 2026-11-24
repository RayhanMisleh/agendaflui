'use client'
import { useActionState } from 'react'
import { Button, Card, Field, Input } from '@/ui/components'
import { salvarSenha } from '../actions'
import { ESTADO_CONTA } from '../_lib/estado'
import { Retorno } from './Retorno'

/** "Senha": cria a primeira (quem só tem Google) ou troca a atual. Trocar mantém este aparelho e sai dos outros. */
export function SenhaForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState(salvarSenha, ESTADO_CONTA)
  const f = state.fields
  return (
    <Card as="section" id="senha" aria-labelledby="conta-senha" className="af-conta__card">
      <div className="af-conta__head">
        <h2 id="conta-senha" className="af-section__title">
          Senha
        </h2>
        <span className="af-conta__muted">{hasPassword ? 'Definida' : 'Ainda não criada'}</span>
      </div>
      {!hasPassword ? <p className="af-conta__muted">Com uma senha você entra mesmo sem o Google.</p> : null}
      <form action={action} className="af-conta__form">
        <Retorno state={state} />
        {hasPassword ? (
          <Field label="Senha atual" error={f['senhaAtual']}>
            <Input name="senhaAtual" type="password" autoComplete="current-password" required invalid={Boolean(f['senhaAtual'])} />
          </Field>
        ) : null}
        <Field label="Senha nova" hint="Use pelo menos 10 caracteres." error={f['senhaNova']}>
          <Input name="senhaNova" type="password" autoComplete="new-password" minLength={10} maxLength={200} required invalid={Boolean(f['senhaNova'])} />
        </Field>
        <Field label="Repita a senha nova" error={f['senhaConfirma']}>
          <Input name="senhaConfirma" type="password" autoComplete="new-password" minLength={10} maxLength={200} required invalid={Boolean(f['senhaConfirma'])} />
        </Field>
        {hasPassword ? <p className="af-conta__muted">Ao trocar, você continua aqui e os outros aparelhos pedem a senha de novo.</p> : null}
        <Button type="submit" variant="primary" loading={pending}>
          {hasPassword ? 'Trocar senha' : 'Criar senha'}
        </Button>
      </form>
    </Card>
  )
}
