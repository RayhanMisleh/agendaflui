'use client'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, Input, Select } from '@/ui/components'
import { PainelForm } from '../../_lib/PainelForm'
import type { EstadoPainel } from '../../_lib/PainelForm'
import { convidarEquipe } from '../actions'

const MAX = 5

/** Passo 6: convidar até cinco pessoas por e-mail. Opcional: sem ninguém, é só pular. */
export function PassoEquipe() {
  const inicial: EstadoPainel = { ok: false, message: null, fields: {}, values: {} }
  return (
    <PainelForm action={convidarEquipe} initial={inicial} submit="Enviar convites e continuar" anchors={{}}>
      {(state) => <Pessoas valores={state.values} erros={state.fields} />}
    </PainelForm>
  )
}

function Pessoas({ valores, erros }: { valores: Record<string, string>; erros: Record<string, string> }) {
  const [n, setN] = useState(() => Math.min(MAX, Math.max(1, Number(valores.n) || 1)))
  return (
    <>
      <p className="af-onb__lead">Cada pessoa recebe um convite por e-mail para criar a senha. Você muda o acesso depois, em Profissionais.</p>
      <input type="hidden" name="n" value={String(n)} />
      <ul className="af-onb__people">
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className="af-onb__person">
            <Field label="Nome" error={erros[`t_${i}_name`]}>
              <Input name={`t_${i}_name`} defaultValue={valores[`t_${i}_name`] ?? ''} maxLength={80} autoComplete="off" />
            </Field>
            <Field label="E-mail" error={erros[`t_${i}_email`]}>
              <Input name={`t_${i}_email`} type="email" inputMode="email" defaultValue={valores[`t_${i}_email`] ?? ''} autoComplete="off" />
            </Field>
            <Field label="Papel">
              <Select name={`t_${i}_role`} defaultValue={valores[`t_${i}_role`] === 'MANAGER' ? 'MANAGER' : 'PROFESSIONAL'}>
                <option value="PROFESSIONAL">Profissional</option>
                <option value="MANAGER">Gerente</option>
              </Select>
            </Field>
          </li>
        ))}
      </ul>
      {n < MAX ? (
        <div>
          <Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => setN((x) => Math.min(MAX, x + 1))}>
            Adicionar pessoa
          </Button>
        </div>
      ) : null}
    </>
  )
}
