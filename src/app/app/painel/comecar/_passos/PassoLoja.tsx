'use client'
import { Field, Input, MaskedInput } from '@/ui/components'
import { PainelForm } from '../../_lib/PainelForm'
import type { EstadoPainel } from '../../_lib/PainelForm'
import { salvarLoja } from '../actions'

/** Passo 1: nome e contato da loja (o que aparece nos e-mails e na página dos clientes). */
export function PassoLoja({ version, name, contactEmail, contactPhone }: { version: number; name: string; contactEmail: string; contactPhone: string }) {
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: { name, contactEmail, contactPhone } }
  return (
    <PainelForm
      action={salvarLoja}
      initial={inicial}
      submit="Salvar e continuar"
      labels={{ name: 'Nome da loja', contactEmail: 'E-mail de contato', contactPhone: 'Telefone de contato' }}
    >
      {(state) => (
        <>
          <input type="hidden" name="version" value={String(version)} />
          <Field label="Nome da loja" hint="Aparece no painel, nos e-mails e na página dos clientes." error={state.fields.name}>
            <Input name="name" defaultValue={state.values.name ?? ''} maxLength={80} autoComplete="off" required />
          </Field>
          <div className="af-formgrid">
            <Field label="E-mail de contato" error={state.fields.contactEmail}>
              <Input name="contactEmail" type="email" inputMode="email" defaultValue={state.values.contactEmail ?? ''} autoComplete="off" />
            </Field>
            <Field label="Telefone de contato" hint="Com DDD." error={state.fields.contactPhone}>
              <MaskedInput mask="phone" name="contactPhone" defaultValue={state.values.contactPhone ?? ''} />
            </Field>
          </div>
        </>
      )}
    </PainelForm>
  )
}
