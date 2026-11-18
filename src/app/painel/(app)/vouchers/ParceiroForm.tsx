'use client'
import { Checkbox, Field, Input, Textarea } from '@/ui/components'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { criarParceiro, salvarParceiro } from './actions'

const ROTULOS = { name: 'Nome', description: 'Descrição', address: 'Endereço', phone: 'Telefone', website: 'Site' }
const ANCORAS = { name: 'parceiro-nome', description: 'parceiro-descricao', address: 'parceiro-endereco', phone: 'parceiro-telefone', website: 'parceiro-site' }

export type ParceiroDados = { id: string; name: string; description: string; address: string; phone: string; website: string; active: boolean }

/** O formulário do parceiro: cria ou edita. Quem cria vai para a ficha, onde envia o logo. */
export function ParceiroForm({ parceiro }: { parceiro: ParceiroDados | null }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: parceiro ? { id: parceiro.id, name: parceiro.name, description: parceiro.description, address: parceiro.address, phone: parceiro.phone, website: parceiro.website, active: parceiro.active ? 'on' : '' } : { active: 'on' },
  }
  return (
    <PainelForm action={parceiro ? salvarParceiro : criarParceiro} initial={inicial} submit={parceiro ? 'Salvar parceiro' : 'Criar parceiro'} labels={ROTULOS} anchors={ANCORAS}>
      {(state) => {
        const v = state.values
        return (
          <>
            {parceiro ? <input type="hidden" name="id" value={parceiro.id} /> : null}
            <Field label="Nome do parceiro" error={state.fields.name}>
              <Input id="parceiro-nome" name="name" defaultValue={v.name ?? ''} maxLength={120} autoComplete="off" required />
            </Field>
            <Field label="Descrição" hint="Opcional. Aparece para quem vai comprar." error={state.fields.description}>
              <Textarea id="parceiro-descricao" name="description" rows={3} maxLength={1000} defaultValue={v.description ?? ''} />
            </Field>
            <Field label="Endereço" hint="Opcional. Onde o cliente usa o voucher." error={state.fields.address}>
              <Input id="parceiro-endereco" name="address" defaultValue={v.address ?? ''} maxLength={300} autoComplete="off" />
            </Field>
            <div className="af-formgrid">
              <Field label="Telefone" hint="Opcional." error={state.fields.phone}>
                <Input id="parceiro-telefone" name="phone" inputMode="tel" defaultValue={v.phone ?? ''} maxLength={40} autoComplete="off" />
              </Field>
              <Field label="Site" hint="Opcional. Comece com https://" error={state.fields.website}>
                <Input id="parceiro-site" name="website" inputMode="url" defaultValue={v.website ?? ''} maxLength={300} autoComplete="off" />
              </Field>
            </div>
            <Checkbox name="active" label="Parceiro ativo (os vouchers dele aparecem no app)" defaultChecked={v.active === 'on'} />
          </>
        )
      }}
    </PainelForm>
  )
}
