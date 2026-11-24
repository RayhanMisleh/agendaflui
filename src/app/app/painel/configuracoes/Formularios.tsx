'use client'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Checkbox, EmptyHint, Field, Input, MaskedInput, Select, Switch } from '@/ui/components'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import {
  criarFechamento,
  removerFechamento,
  salvarAnimais,
  salvarAvisos,
  salvarNegocio,
  salvarRegras,
} from './actions'

const estado = (values: Record<string, string>): EstadoPainel => ({ ok: false, message: null, fields: {}, values })
const Versao = ({ version }: { version: number }) => <input type="hidden" name="version" value={String(version)} />

// ---------------------------------------------------------------- negócio

export function NegocioForm({ version, name, contactEmail, contactPhone }: { version: number; name: string; contactEmail: string; contactPhone: string }) {
  return (
    <PainelForm
      action={salvarNegocio}
      initial={estado({ name, contactEmail, contactPhone })}
      submit="Salvar dados"
      labels={{ name: 'Nome do negócio', contactEmail: 'E-mail de contato', contactPhone: 'Telefone de contato' }}
    >
      {(state) => (
        <>
          <Versao version={version} />
          <Field label="Nome do negócio" hint="Aparece na barra lateral e nos e-mails." error={state.fields.name}>
            <Input name="name" defaultValue={state.values.name ?? ''} maxLength={80} autoComplete="off" required />
          </Field>
          <div className="af-formgrid">
            <Field label="E-mail de contato" error={state.fields.contactEmail}>
              <Input name="contactEmail" type="email" inputMode="email" defaultValue={state.values.contactEmail ?? ''} autoComplete="off" />
            </Field>
            <Field label="Telefone de contato" hint="Com DDD. Fora do Brasil, comece com + e o código do país." error={state.fields.contactPhone}>
              <MaskedInput mask="phone" name="contactPhone" defaultValue={state.values.contactPhone ?? ''} />
            </Field>
          </div>
        </>
      )}
    </PainelForm>
  )
}

// ---------------------------------------------------------------- agenda

export type LimitesRegras = {
  grades: readonly number[]
  limites: {
    minLeadMin: { min: number; max: number }
    maxAdvanceDays: { min: number; max: number }
    customerChangeWindowMin: { min: number; max: number }
    bufferMin: { min: number; max: number; step: number }
  }
}

export function RegrasForm({ version, valores, grades, limites }: { version: number; valores: Record<string, string> } & LimitesRegras) {
  return (
    <PainelForm
      action={salvarRegras}
      initial={estado(valores)}
      submit="Salvar regras"
      labels={{ slotStepMin: 'Grade de horários', bufferMin: 'Intervalo entre atendimentos', minLeadMin: 'Antecedência mínima', maxAdvanceDays: 'Alcance da agenda', customerChangeWindowMin: 'Prazo para mudar' }}
    >
      {(state) => {
        const v = state.values
        return (
          <>
            <Versao version={version} />
            <div className="af-formgrid">
              <Field label="Grade de horários" hint="De quanto em quanto tempo um horário pode começar." error={state.fields.slotStepMin}>
                <Select name="slotStepMin" defaultValue={v.slotStepMin ?? ''}>
                  {grades.map((g) => (
                    <option key={g} value={String(g)}>
                      {g} minutos
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Intervalo entre atendimentos (minutos)" hint={`Múltiplo de ${limites.bufferMin.step}, até ${limites.bufferMin.max}.`} error={state.fields.bufferMin}>
                <Input name="bufferMin" type="number" inputMode="numeric" min={limites.bufferMin.min} max={limites.bufferMin.max} step={limites.bufferMin.step} defaultValue={v.bufferMin ?? ''} />
              </Field>
              <Field label="Antecedência mínima (minutos)" hint="Quanto antes do horário o cliente ainda pode marcar." error={state.fields.minLeadMin}>
                <Input name="minLeadMin" type="number" inputMode="numeric" min={limites.minLeadMin.min} max={limites.minLeadMin.max} defaultValue={v.minLeadMin ?? ''} />
              </Field>
              <Field label="Alcance da agenda (dias)" hint="Até quantos dias à frente se pode marcar." error={state.fields.maxAdvanceDays}>
                <Input name="maxAdvanceDays" type="number" inputMode="numeric" min={limites.maxAdvanceDays.min} max={limites.maxAdvanceDays.max} defaultValue={v.maxAdvanceDays ?? ''} />
              </Field>
              <Field label="Prazo para o cliente mudar (minutos)" hint="Até quanto tempo antes o cliente pode remarcar ou cancelar." error={state.fields.customerChangeWindowMin}>
                <Input name="customerChangeWindowMin" type="number" inputMode="numeric" min={limites.customerChangeWindowMin.min} max={limites.customerChangeWindowMin.max} defaultValue={v.customerChangeWindowMin ?? ''} />
              </Field>
            </div>
            <Checkbox name="autoConfirm" label="Confirmar os agendamentos sozinho" defaultChecked={v.autoConfirm === 'on'} />
          </>
        )
      }}
    </PainelForm>
  )
}

// ---------------------------------------------------------------- animais

export function AnimaisForm({ version, servesCats }: { version: number; servesCats: boolean }) {
  return (
    <PainelForm action={salvarAnimais} initial={estado({ servesCats: servesCats ? 'on' : '' })} submit="Salvar animais" labels={{ servesCats: 'Atende gatos' }}>
      {(state) => <AnimaisCampos version={version} inicial={state.values.servesCats === 'on'} />}
    </PainelForm>
  )
}

function AnimaisCampos({ version, inicial }: { version: number; inicial: boolean }) {
  const [gatos, setGatos] = useState(inicial)
  return (
    <>
      <Versao version={version} />
      {gatos ? <input type="hidden" name="servesCats" value="on" /> : null}
      <Switch checked={gatos} onCheckedChange={setGatos} label="Atende gatos" />
      <p className="af-field__hint">
        Desligado: os clientes não marcam horário para gatos e a tabela de preços esconde a linha de gato. A equipe ainda pode marcar. Nada é apagado.
      </p>
    </>
  )
}

// ---------------------------------------------------------------- avisos

export function AvisosForm({ version, valores, avisos }: { version: number; valores: Record<string, string>; avisos: { kind: string; label: string }[] }) {
  return (
    <PainelForm action={salvarAvisos} initial={estado(valores)} submit="Salvar avisos">
      {(state) => (
        <>
          <Versao version={version} />
          <div className="af-matrix__scroll">
            <table className="af-matrix">
              <caption className="af-sr">Avisos por tipo</caption>
              <thead>
                <tr>
                  <th scope="col">Aviso</th>
                  <th scope="col">E-mail</th>
                </tr>
              </thead>
              <tbody>
                {avisos.map((a) => (
                  <tr key={a.kind}>
                    <th scope="row">{a.label}</th>
                    <td>
                      <Checkbox name={`${a.kind}__email`} label={<span className="af-sr">{a.label}: e-mail</span>} defaultChecked={state.values[`${a.kind}__email`] === 'on'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PainelForm>
  )
}

// ---------------------------------------------------------------- fechamentos

export type FechamentoLinha = { id: string; label: string; reason: string | null }

export function FechamentosLista({ fechamentos }: { fechamentos: FechamentoLinha[] }) {
  if (fechamentos.length === 0) return <EmptyHint>Nenhum fechamento marcado. Use para feriados, férias e reformas.</EmptyHint>
  return (
    <ul className="af-closures">
      {fechamentos.map((f) => (
        <li key={f.id} className="af-closures__item">
          <span>
            <span className="af-closures__when">{f.label}</span>
            {f.reason ? <span className="af-closures__why">{f.reason}</span> : null}
          </span>
          <AcaoDeLinha action={removerFechamento} campos={{ id: f.id }} icon={<Trash2 size={16} />} ariaLabel={`Remover o fechamento de ${f.label}`} showOk>
            Remover
          </AcaoDeLinha>
        </li>
      ))}
    </ul>
  )
}

/** Cria um fechamento. Se há agendamentos no intervalo, o primeiro envio só avisa quantos; o botão passa a dizer "Fechar mesmo assim". */
export function FechamentoForm({ hoje }: { hoje: string }) {
  return (
    <PainelForm
      action={criarFechamento}
      initial={estado({ startDate: hoje, endDate: hoje })}
      submit={(s) => (s.values.affected && !s.ok ? 'Fechar mesmo assim' : 'Criar fechamento')}
      labels={{ startDate: 'Primeiro dia', endDate: 'Último dia', reason: 'Motivo' }}
    >
      {(state) => {
        const v = state.values
        return (
          <>
            {!state.ok && v.affected && v.confirm ? <input type="hidden" name="confirm" value={v.confirm} /> : null}
            <div className="af-formgrid">
              <Field label="Primeiro dia" error={state.fields.startDate}>
                <Input type="date" name="startDate" defaultValue={v.startDate ?? ''} required />
              </Field>
              <Field label="Último dia" error={state.fields.endDate}>
                <Input type="date" name="endDate" defaultValue={v.endDate ?? ''} required />
              </Field>
            </div>
            <Field label="Motivo" hint="Opcional. Só a equipe vê." error={state.fields.reason}>
              <Input name="reason" defaultValue={v.reason ?? ''} maxLength={200} autoComplete="off" />
            </Field>
          </>
        )
      }}
    </PainelForm>
  )
}
