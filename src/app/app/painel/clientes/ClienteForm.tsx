'use client'
import { Checkbox, Field, Input, Textarea } from '@/ui/components'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { criarCliente, editarCliente } from './actions'

export type ClienteDados = { id: string; name: string; phoneLabel: string | null; email: string | null; birthDate: string | null; notes: string | null; isClubMember: boolean; hasAccount?: boolean }

const ROTULOS = { name: 'Nome', phone: 'Telefone', email: 'E-mail', birthDate: 'Nascimento', notes: 'Observações', isClubMember: 'Clube' }
const ANCORAS = { name: 'cliente-nome', phone: 'cliente-telefone', email: 'cliente-email', birthDate: 'cliente-nascimento', notes: 'cliente-observacoes' }

/** Cria (sem `cliente`) ou edita o cadastro. Criar leva à ficha; editar mostra a confirmação aqui mesmo. */
export function ClienteForm({ cliente, clube, singular }: { cliente: ClienteDados | null; clube: string | null; singular: string }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: cliente
      ? {
          id: cliente.id,
          name: cliente.name,
          phone: cliente.phoneLabel ?? '',
          email: cliente.email ?? '',
          birthDate: cliente.birthDate ?? '',
          notes: cliente.notes ?? '',
          isClubMember: cliente.isClubMember ? 'on' : '',
        }
      : {},
  }
  return (
    <PainelForm action={cliente ? editarCliente : criarCliente} initial={inicial} submit={cliente ? 'Salvar alterações' : `Cadastrar ${singular.toLowerCase()}`} labels={ROTULOS} anchors={ANCORAS}>
      {(state) => {
        const v = state.values
        return (
          <>
            {cliente ? <input type="hidden" name="id" value={cliente.id} /> : null}
            {clube ? <input type="hidden" name="loyalty" value="1" /> : null}
            <Field label="Nome" error={state.fields.name}>
              <Input id="cliente-nome" name="name" defaultValue={v.name ?? ''} maxLength={120} autoComplete="off" required />
            </Field>
            <div className="af-formgrid">
              <Field label="Telefone" hint="Com DDD. Para número de outro país, comece com + e o código do país, por exemplo +49 151 1234 5678." error={state.fields.phone}>
                <Input id="cliente-telefone" name="phone" type="tel" inputMode="tel" defaultValue={v.phone ?? ''} autoComplete="off" />
              </Field>
              <Field label="E-mail" hint={cliente?.hasAccount ? 'O e-mail é da conta do cliente.' : undefined} error={state.fields.email}>
                <Input id="cliente-email" name="email" type="email" defaultValue={v.email ?? ''} autoComplete="off" readOnly={cliente?.hasAccount === true} />
              </Field>
            </div>
            <Field label="Nascimento" hint="Opcional." error={state.fields.birthDate}>
              <Input id="cliente-nascimento" name="birthDate" type="date" min="1900-01-01" defaultValue={v.birthDate ?? ''} />
            </Field>
            <Field label="Observações internas" hint="Só a equipe vê. O cliente nunca recebe este texto." error={state.fields.notes}>
              <Textarea id="cliente-observacoes" name="notes" defaultValue={v.notes ?? ''} maxLength={2000} rows={4} />
            </Field>
            {clube ? <Checkbox name="isClubMember" label={`Faz parte do ${clube}`} defaultChecked={v.isClubMember === 'on'} /> : null}
          </>
        )
      }}
    </PainelForm>
  )
}
