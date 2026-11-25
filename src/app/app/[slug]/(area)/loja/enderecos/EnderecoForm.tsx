'use client'
import { useRef, useState } from 'react'
import { Checkbox, Field, Input, MaskedInput, Select } from '@/ui/components'
import { STATES } from '@/shared/states'
import { ClienteForm } from '../../../_lib/ClienteForm'
import { salvarEndereco } from '../actions'
import { buscarCep } from '../consultas'

export type EnderecoDoForm = {
  id: string
  label: string | null
  recipientName: string
  postalCode: string
  street: string
  number: string
  complement: string | null
  district: string
  city: string
  state: string
  isDefault: boolean
}

type Campos = { recipientName: string; postalCode: string; street: string; number: string; complement: string; district: string; city: string; state: string; label: string }

const VAZIO: Campos = { recipientName: '', postalCode: '', street: '', number: '', complement: '', district: '', city: '', state: '', label: '' }

/**
 * Endereço de entrega: cria (sem `endereco`) ou edita. Ao completar o CEP, busca rua, bairro, cidade e estado (a pessoa
 * confere e completa o número); se a busca não responder, ela digita. Quem decide é o servidor, que recusa campo vazio.
 */
export function EnderecoForm({ slug, endereco, nomeInicial = '', primeiro = false, onDone }: { slug: string; endereco: EnderecoDoForm | null; nomeInicial?: string; primeiro?: boolean; onDone?: (id: string) => void }) {
  const [c, setC] = useState<Campos>(
    endereco
      ? { recipientName: endereco.recipientName, postalCode: endereco.postalCode, street: endereco.street, number: endereco.number, complement: endereco.complement ?? '', district: endereco.district, city: endereco.city, state: endereco.state, label: endereco.label ?? '' }
      : { ...VAZIO, recipientName: nomeInicial },
  )
  const [aviso, setAviso] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const ultimoCep = useRef(endereco ? endereco.postalCode.replace(/\D/g, '') : '')
  const mudar = (campo: keyof Campos) => (e: { target: { value: string } }) => setC((atual) => ({ ...atual, [campo]: e.target.value }))

  async function aoMudarCep(valor: string) {
    setC((atual) => ({ ...atual, postalCode: valor }))
    const digitos = valor.replace(/\D/g, '')
    if (digitos.length !== 8 || digitos === ultimoCep.current) return
    ultimoCep.current = digitos
    setBuscando(true)
    setAviso(null)
    const r = await buscarCep(slug, digitos)
    setBuscando(false)
    if (!r.ok) setAviso(r.message)
    else if (r.indisponivel) setAviso('Não deu para buscar o CEP agora. Preencha o endereço.')
    else if (r.endereco === null) setAviso('CEP não encontrado. Confira os números ou preencha o endereço.')
    else {
      const achado = r.endereco
      setC((atual) => ({ ...atual, street: achado.street, district: achado.district, city: achado.city, state: achado.state }))
    }
  }

  return (
    <ClienteForm action={salvarEndereco} slug={slug} hidden={endereco ? { id: endereco.id } : {}} submit="Salvar endereço" onDone={(estado) => onDone?.(estado.values['id'] ?? '')}>
      {(estado) => {
        const f = estado.fields
        return (
          <>
            <Field label="Nome de quem recebe" error={f['recipientName']}>
              <Input name="recipientName" autoComplete="name" required maxLength={80} value={c.recipientName} onChange={mudar('recipientName')} invalid={Boolean(f['recipientName'])} />
            </Field>
            <Field label="CEP" hint={buscando ? 'Buscando o endereço…' : undefined} error={f['postalCode']}>
              <MaskedInput mask="cep" name="postalCode" autoComplete="postal-code" required value={c.postalCode} onChange={(e) => void aoMudarCep(e.target.value)} invalid={Boolean(f['postalCode'])} />
            </Field>
            {aviso ? (
              <p role="status" className="af-cl-muted">
                {aviso}
              </p>
            ) : null}
            <Field label="Rua" error={f['street']}>
              <Input name="street" autoComplete="address-line1" required maxLength={120} value={c.street} onChange={mudar('street')} invalid={Boolean(f['street'])} />
            </Field>
            <div className="af-cl-form__pair">
              <Field label="Número" error={f['number']}>
                <Input name="number" required maxLength={10} value={c.number} onChange={mudar('number')} invalid={Boolean(f['number'])} />
              </Field>
              <Field label="Complemento" hint="Opcional" error={f['complement']}>
                <Input name="complement" maxLength={80} value={c.complement} onChange={mudar('complement')} invalid={Boolean(f['complement'])} />
              </Field>
            </div>
            <Field label="Bairro" error={f['district']}>
              <Input name="district" required maxLength={80} value={c.district} onChange={mudar('district')} invalid={Boolean(f['district'])} />
            </Field>
            <div className="af-cl-form__pair">
              <Field label="Cidade" error={f['city']}>
                <Input name="city" autoComplete="address-level2" required maxLength={80} value={c.city} onChange={mudar('city')} invalid={Boolean(f['city'])} />
              </Field>
              <Field label="Estado" error={f['state']}>
                <Select name="state" required value={c.state} onChange={mudar('state')} invalid={Boolean(f['state'])}>
                  <option value="">Escolha</option>
                  {STATES.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Apelido" hint="Opcional. Por exemplo: Casa." error={f['label']}>
              <Input name="label" maxLength={30} value={c.label} onChange={mudar('label')} invalid={Boolean(f['label'])} />
            </Field>
            {primeiro ? null : <Checkbox name="isDefault" defaultChecked={endereco?.isDefault ?? false} label="Usar como endereço padrão" />}
          </>
        )
      }}
    </ClienteForm>
  )
}
