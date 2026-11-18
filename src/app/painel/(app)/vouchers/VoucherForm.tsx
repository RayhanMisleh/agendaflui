'use client'
import { Checkbox, Field, Input, MoneyField, Select, Textarea } from '@/ui/components'
import { formatMoneyInput } from '@/ui/money'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import { criarVoucher, salvarVoucher } from './actions'

const ROTULOS = { partnerId: 'Parceiro', name: 'Nome', description: 'Descrição', terms: 'Regras de uso', price: 'Preço', stock: 'Estoque', validDays: 'Validade' }
const ANCORAS = { partnerId: 'voucher-parceiro', name: 'voucher-nome', description: 'voucher-descricao', terms: 'voucher-regras', price: 'voucher-preco', stock: 'voucher-estoque', validDays: 'voucher-validade' }

export type VoucherDados = { id: string; partnerId: string; name: string; description: string; terms: string; priceCents: number; stock: number; validDays: number | null; active: boolean }

/**
 * O formulário do voucher: cria (com o estoque inicial) ou edita. Na edição o estoque vai com o valor que a página leu
 * (`expectedStock`): se uma venda mudou o estoque no meio, a gravação é recusada e a pessoa recarrega.
 */
export function VoucherForm({ voucher, parceiros }: { voucher: VoucherDados | null; parceiros: { id: string; name: string }[] }) {
  const inicial: EstadoPainel = {
    ok: false,
    message: null,
    fields: {},
    values: voucher
      ? {
          id: voucher.id,
          partnerId: voucher.partnerId,
          name: voucher.name,
          description: voucher.description,
          terms: voucher.terms,
          price: formatMoneyInput(voucher.priceCents),
          stock: String(voucher.stock),
          expectedStock: String(voucher.stock),
          validDays: voucher.validDays === null ? '' : String(voucher.validDays),
          active: voucher.active ? 'on' : '',
        }
      : { active: 'on', stock: '0', validDays: '30' },
  }
  return (
    <PainelForm action={voucher ? salvarVoucher : criarVoucher} initial={inicial} submit={voucher ? 'Salvar voucher' : 'Criar voucher'} labels={ROTULOS} anchors={ANCORAS}>
      {(state) => {
        const v = state.values
        return (
          <>
            {voucher ? <input type="hidden" name="id" value={voucher.id} /> : null}
            {voucher ? <input type="hidden" name="expectedStock" value={v.expectedStock ?? String(voucher.stock)} /> : null}
            <Field label="Parceiro" hint="Quem aceita o voucher. Só aparecem parceiros ativos." error={state.fields.partnerId}>
              <Select id="voucher-parceiro" name="partnerId" defaultValue={v.partnerId ?? ''} required>
                <option value="">Escolha um parceiro</option>
                {parceiros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nome do voucher" error={state.fields.name}>
              <Input id="voucher-nome" name="name" defaultValue={v.name ?? ''} maxLength={120} autoComplete="off" required />
            </Field>
            <Field label="Descrição" hint="Opcional. Aparece para quem vai comprar." error={state.fields.description}>
              <Textarea id="voucher-descricao" name="description" rows={3} maxLength={1000} defaultValue={v.description ?? ''} />
            </Field>
            <Field label="Regras de uso" hint="Opcional. Dias, horários e o que não vale." error={state.fields.terms}>
              <Textarea id="voucher-regras" name="terms" rows={3} maxLength={2000} defaultValue={v.terms ?? ''} />
            </Field>
            <div className="af-formgrid">
              <Field label="Preço (R$)" error={state.fields.price}>
                <MoneyField id="voucher-preco" name="price" defaultValue={v.price ?? ''} required />
              </Field>
              <Field label={voucher ? 'Estoque' : 'Estoque inicial'} hint="Unidades à venda." error={state.fields.stock}>
                <Input id="voucher-estoque" name="stock" inputMode="numeric" defaultValue={v.stock ?? '0'} required />
              </Field>
              <Field label="Validade (dias)" hint="Contados do pagamento. Em branco, não vence. De 1 a 730." error={state.fields.validDays}>
                <Input id="voucher-validade" name="validDays" inputMode="numeric" defaultValue={v.validDays ?? ''} />
              </Field>
            </div>
            <Checkbox name="active" label="À venda no app" defaultChecked={v.active === 'on'} />
          </>
        )
      }}
    </PainelForm>
  )
}
