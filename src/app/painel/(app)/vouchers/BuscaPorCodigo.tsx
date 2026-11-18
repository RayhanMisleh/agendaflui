'use client'
import { useActionState } from 'react'
import { Button, Field, FormErrors, Input } from '@/ui/components'
import { ESTADO_INICIAL } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { buscarPorCodigo } from './actions'

/**
 * Busca pelo código (ou um pedaço dele) por formulário POST: o código nunca vai para a URL, para o histórico do navegador
 * nem para o log do proxy. O resultado aparece aqui mesmo, abaixo do campo.
 */
export function BuscaPorCodigo() {
  const [state, formAction, pending] = useActionState<EstadoPainel, FormData>(buscarPorCodigo, ESTADO_INICIAL)
  const linhas = state.ok ? (state.values.lista ?? '').split('\n').filter((l) => l !== '') : []
  return (
    <div className="af-profile af-profile--narrow">
      <form action={formAction} className="af-acctform" method="post" noValidate>
        {state.ok ? null : <FormErrors message={state.message} fields={state.fields} labels={{ code: 'Código' }} anchors={{ code: 'busca-codigo' }} />}
        <Field label="Buscar pelo código" hint="Digite o código inteiro ou só o começo (3 letras ou mais). Esta busca não fica no endereço da página." error={state.fields.code}>
          <Input id="busca-codigo" name="code" className="af-input--code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} defaultValue={state.values.code ?? ''} required />
        </Field>
        <div className="af-acctform__foot">
          <Button type="submit" variant="secondary" loading={pending}>
            Buscar código
          </Button>
        </div>
      </form>
      {state.ok && state.message ? (
        <div role="status">
          <p>{state.message}</p>
          {linhas.length > 0 ? (
            <ul>
              {linhas.map((l) => (
                <li key={l}>{l.split(' | ').join(' · ')}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
