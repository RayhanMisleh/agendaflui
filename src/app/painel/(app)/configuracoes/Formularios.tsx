'use client'
import { Trash2 } from 'lucide-react'
import { Checkbox, CopyButton, EmptyHint, Field, Input, Select } from '@/ui/components'
import { AcaoDeLinha } from '../_lib/AcaoDeLinha'
import { PainelForm } from '../_lib/PainelForm'
import type { EstadoPainel } from '../_lib/PainelForm'
import {
  criarFechamento,
  removerFechamento,
  salvarAvisos,
  salvarNegocio,
  salvarPerfil,
  salvarRegras,
  salvarTermos,
  trocarSenha,
} from './actions'

const estado = (values: Record<string, string>): EstadoPainel => ({ ok: false, message: null, fields: {}, values })
const Versao = ({ version }: { version: number }) => <input type="hidden" name="version" value={String(version)} />

// ---------------------------------------------------------------- negócio

export function NegocioForm({ version, name, contactEmail, contactPhone, entryUrl }: { version: number; name: string; contactEmail: string; contactPhone: string; entryUrl: string }) {
  return (
    <>
      <PainelForm
        action={salvarNegocio}
        initial={estado({ name, contactEmail, contactPhone })}
        submit="Salvar dados"
        labels={{ name: 'Nome do negócio', contactEmail: 'E-mail de contato', contactPhone: 'Telefone de contato' }}
      >
        {(state) => (
          <>
            <Versao version={version} />
            <Field label="Nome do negócio" hint="Aparece na barra lateral, na entrada e nos e-mails." error={state.fields.name}>
              <Input name="name" defaultValue={state.values.name ?? ''} maxLength={80} autoComplete="off" required />
            </Field>
            <div className="af-formgrid">
              <Field label="E-mail de contato" error={state.fields.contactEmail}>
                <Input name="contactEmail" type="email" inputMode="email" defaultValue={state.values.contactEmail ?? ''} autoComplete="off" />
              </Field>
              <Field label="Telefone de contato" hint="Com DDD. Fora do Brasil, comece com + e o código do país." error={state.fields.contactPhone}>
                <Input name="contactPhone" type="tel" inputMode="tel" defaultValue={state.values.contactPhone ?? ''} autoComplete="off" />
              </Field>
            </div>
          </>
        )}
      </PainelForm>
      <div className="af-acctform">
        <Field label="Link de entrada da equipe" hint="Quem trabalha na conta entra por este endereço.">
          <Input readOnly value={entryUrl} onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <CopyButton text={entryUrl} label="Copiar o link de entrada" variant="secondary" />
      </div>
    </>
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

// ---------------------------------------------------------------- avisos

export function AvisosForm({ version, valores, avisos }: { version: number; valores: Record<string, string>; avisos: { kind: string; label: string }[] }) {
  return (
    <PainelForm action={salvarAvisos} initial={estado(valores)} submit="Salvar avisos">
      {(state) => (
        <>
          <Versao version={version} />
          <table className="af-matrix">
            <caption className="af-sr">Avisos por tipo e canal</caption>
            <thead>
              <tr>
                <th scope="col">Aviso</th>
                <th scope="col">E-mail</th>
                <th scope="col">No aplicativo</th>
              </tr>
            </thead>
            <tbody>
              {avisos.map((a) => (
                <tr key={a.kind}>
                  <th scope="row">{a.label}</th>
                  <td>
                    <Checkbox name={`${a.kind}__email`} label={<span className="af-sr">{a.label}: e-mail</span>} defaultChecked={state.values[`${a.kind}__email`] === 'on'} />
                  </td>
                  <td>
                    <Checkbox name={`${a.kind}__push`} label={<span className="af-sr">{a.label}: no aplicativo</span>} defaultChecked={state.values[`${a.kind}__push`] === 'on'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </PainelForm>
  )
}

// ---------------------------------------------------------------- termos

const CAMPOS_TERMOS: { name: string; label: string; hint?: string }[] = [
  { name: 'professionalSingular', label: 'Profissional (singular)' },
  { name: 'professionalPlural', label: 'Profissional (plural)' },
  { name: 'customerSingular', label: 'Cliente (singular)' },
  { name: 'customerPlural', label: 'Cliente (plural)' },
  { name: 'pointsSingular', label: 'Pontos (singular)' },
  { name: 'pointsPlural', label: 'Pontos (plural)' },
  { name: 'club', label: 'Clube', hint: 'O nome do programa de fidelidade.' },
]

export function TermosForm({ version, valores }: { version: number; valores: Record<string, string> }) {
  return (
    <PainelForm action={salvarTermos} initial={estado(valores)} submit="Salvar termos" labels={Object.fromEntries(CAMPOS_TERMOS.map((c) => [c.name, c.label]))}>
      {(state) => (
        <>
          <Versao version={version} />
          <div className="af-formgrid">
            {CAMPOS_TERMOS.map((c) => (
              <Field key={c.name} label={c.label} {...(c.hint ? { hint: c.hint } : {})} error={state.fields[c.name]}>
                <Input name={c.name} defaultValue={state.values[c.name] ?? ''} maxLength={30} autoComplete="off" />
              </Field>
            ))}
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

// ---------------------------------------------------------------- meu perfil

export function PerfilForm({ name, email }: { name: string; email: string }) {
  return (
    <PainelForm action={salvarPerfil} initial={estado({ name })} submit="Salvar perfil" labels={{ name: 'Nome' }}>
      {(state) => (
        <>
          <Field label="Nome" error={state.fields.name}>
            <Input name="name" defaultValue={state.values.name ?? ''} maxLength={80} autoComplete="name" required />
          </Field>
          <Field label="E-mail" hint="É com ele que você entra. Para trocar, fale com o dono da conta.">
            <Input value={email} readOnly />
          </Field>
        </>
      )}
    </PainelForm>
  )
}

export function SenhaForm() {
  return (
    <PainelForm
      action={trocarSenha}
      submit="Trocar senha"
      labels={{ senhaAtual: 'Senha atual', senhaNova: 'Senha nova', senhaConfirma: 'Repita a senha nova' }}
    >
      {(state) => (
        <>
          <Field label="Senha atual" error={state.fields.senhaAtual}>
            <Input name="senhaAtual" type="password" autoComplete="current-password" required />
          </Field>
          <div className="af-formgrid">
            <Field label="Senha nova" hint="Use pelo menos 10 caracteres." error={state.fields.senhaNova}>
              <Input name="senhaNova" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
            </Field>
            <Field label="Repita a senha nova" error={state.fields.senhaConfirma}>
              <Input name="senhaConfirma" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
            </Field>
          </div>
          <p className="af-section__help">Ao trocar, você continua aqui e as outras sessões e o aplicativo pedem a senha de novo.</p>
        </>
      )}
    </PainelForm>
  )
}
