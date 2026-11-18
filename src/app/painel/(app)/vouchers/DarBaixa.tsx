'use client'
import { useActionState, useState } from 'react'
import { Button, Field, FormErrors, Input } from '@/ui/components'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { ESTADO_INICIAL } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { consultarCodigo, darBaixa } from './actions'

/**
 * A aba "Dar baixa": o balcão digita o código, vê o cartão (voucher, parceiro e cliente) e só então dá a baixa. O código
 * pode ter minúsculas, espaços e ficar sem o hífen. Sem JavaScript o formulário também funciona (a ação roda no servidor).
 */
export function DarBaixa() {
  const [state, formAction, pending] = useActionState<EstadoPainel, FormData>(consultarCodigo, ESTADO_INICIAL)
  const [baixado, setBaixado] = useState<string | null>(null)
  const jaBaixado = baixado !== null && baixado === state.values.code
  const valido = state.ok && state.values.status === 'ACTIVE'
  return (
    <div className="af-profile af-profile--narrow">
      <form action={formAction} className="af-acctform" noValidate>
        {state.ok ? null : <FormErrors message={state.message} fields={state.fields} labels={{ code: 'Código' }} anchors={{ code: 'baixa-codigo' }} />}
        <Field label="Código do voucher" hint="Como está no app do cliente, por exemplo K7QM-4XHT. Pode digitar sem o hífen e em minúsculas." error={state.fields.code}>
          <Input id="baixa-codigo" name="code" className="af-input--code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} defaultValue={state.ok ? '' : (state.values.code ?? '')} required />
        </Field>
        <div className="af-acctform__foot">
          <Button type="submit" variant="primary" loading={pending}>
            Conferir código
          </Button>
        </div>
      </form>
      {state.ok && state.message ? (
        <div role="status" className={valido ? 'af-redeemcard' : 'af-redeemcard af-redeemcard--refused'}>
          <p>{state.message}</p>
          {valido && jaBaixado ? <p className="af-acctform__ok">Baixa feita. Este código não vale mais.</p> : null}
          {valido && !jaBaixado ? (
            <AcaoDeLinha action={darBaixa} campos={{ code: state.values.code ?? '' }} variant="primary" size="md" onDone={() => setBaixado(state.values.code ?? '')}>
              Dar baixa
            </AcaoDeLinha>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
