'use client'
import { useId } from 'react'
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/components'
import { ContaForm } from './ContaForm'
import { estadoInicial } from './forms'
import type { AcaoConta, Campos } from './forms'

/** Dados cadastrais: a versão vem do servidor a cada carga; versão velha vira o aviso de conflito. */
export function DadosForm({ action, valores }: { action: AcaoConta; valores: Campos }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar dados">
      {({ values: v, fields }) => (
        <>
          <div className="af-wizard__grid">
            <Field label="Nome da conta" error={fields.name}>
              <Input name="name" defaultValue={v.name} autoComplete="off" />
            </Field>
            <Field label="Identificador" hint="Trocar o identificador muda o link de entrada da conta." error={fields.slug}>
              <Input name="slug" defaultValue={v.slug} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="E-mail de contato" error={fields.contactEmail}>
              <Input name="contactEmail" type="email" inputMode="email" defaultValue={v.contactEmail} autoComplete="off" />
            </Field>
            <Field label="Telefone" error={fields.contactPhone}>
              <Input name="contactPhone" type="tel" inputMode="tel" defaultValue={v.contactPhone} autoComplete="off" />
            </Field>
            <Field label="Razão social" error={fields.legalName}>
              <Input name="legalName" defaultValue={v.legalName} autoComplete="off" />
            </Field>
            <Field label="CPF ou CNPJ" error={fields.document}>
              <Input name="document" defaultValue={v.document} autoComplete="off" />
            </Field>
          </div>
          <Field label="Observações internas" hint="Só a equipe da plataforma vê." error={fields.internalNotes}>
            <Textarea name="internalNotes" defaultValue={v.internalNotes} rows={3} />
          </Field>
        </>
      )}
    </ContaForm>
  )
}

export function TermosForm({ action, valores }: { action: AcaoConta; valores: Campos }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar termos">
      {({ values: v, fields }) => (
        <div className="af-wizard__grid">
          <Field label="Profissional (singular)" error={fields.professionalSingular}>
            <Input name="professionalSingular" defaultValue={v.professionalSingular} autoComplete="off" />
          </Field>
          <Field label="Profissional (plural)" error={fields.professionalPlural}>
            <Input name="professionalPlural" defaultValue={v.professionalPlural} autoComplete="off" />
          </Field>
          <Field label="Cliente (singular)" error={fields.customerSingular}>
            <Input name="customerSingular" defaultValue={v.customerSingular} autoComplete="off" />
          </Field>
          <Field label="Cliente (plural)" error={fields.customerPlural}>
            <Input name="customerPlural" defaultValue={v.customerPlural} autoComplete="off" />
          </Field>
          <Field label="Pontos (singular)" error={fields.pointsSingular}>
            <Input name="pointsSingular" defaultValue={v.pointsSingular} autoComplete="off" />
          </Field>
          <Field label="Pontos (plural)" error={fields.pointsPlural}>
            <Input name="pointsPlural" defaultValue={v.pointsPlural} autoComplete="off" />
          </Field>
          <Field label="Clube" hint="O nome do programa de fidelidade." error={fields.club}>
            <Input name="club" defaultValue={v.club} autoComplete="off" />
          </Field>
        </div>
      )}
    </ContaForm>
  )
}

export function ModulosForm({ action, valores }: { action: AcaoConta; valores: Campos }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar módulos">
      {({ values: v, fields }) => <ModulosCampos v={v} erroVouchers={fields.vouchers} />}
    </ContaForm>
  )
}

/** O erro de "vouchers exigem Loja" fica ligado ao checkbox de vouchers (`aria-describedby`), não solto no formulário. */
function ModulosCampos({ v, erroVouchers }: { v: Campos; erroVouchers: string | undefined }) {
  const uid = useId()
  const erroId = erroVouchers ? `${uid}-vouchers-erro` : undefined
  return (
    <div className="af-wizard__checks">
      <Checkbox name="loyalty" label="Fidelidade: pontos e prêmios" defaultChecked={v.loyalty === 'on'} />
      <Checkbox name="banners" label="Banners: avisos e promoções no app" defaultChecked={v.banners === 'on'} />
      <Checkbox name="store" label="Loja: produtos e pedidos" defaultChecked={v.store === 'on'} />
      <Checkbox
        name="vouchers"
        label="Vouchers: vendidos dentro de um pedido da Loja"
        defaultChecked={v.vouchers === 'on'}
        {...(erroId ? { 'aria-describedby': erroId, 'aria-invalid': true } : {})}
      />
      {erroVouchers ? (
        <p id={erroId} className="af-field__error">
          {erroVouchers}
        </p>
      ) : null}
      <p className="af-wizard__note">Módulo desligado some do menu, das telas e da API desta conta. Vouchers só funcionam com a Loja ligada.</p>
    </div>
  )
}

export type FusosParaLista = { top: Array<{ value: string; label: string }>; rest: string[] }

/** Grades e limites das regras, lidos do domínio pela página (a tela não repete número de regra). */
export type LimitesDeRegras = {
  grades: readonly number[]
  limites: { minLeadMin: { min: number; max: number }; maxAdvanceDays: { min: number; max: number }; customerChangeWindowMin: { min: number; max: number }; bufferMin: { min: number; max: number; step: number } }
}

/** Regras de agenda e fuso. A lista de fusos põe os do Brasil no topo e deixa os demais num grupo à parte. */
export function RegrasForm({ action, valores, fusos, grades, limites }: { action: AcaoConta; valores: Campos; fusos: FusosParaLista } & LimitesDeRegras) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar regras e fuso">
      {({ values: v, fields }) => (
        <>
          <div className="af-wizard__grid">
            <Field label="Grade de horários" hint="De quanto em quanto tempo um horário pode começar." error={fields.slotStepMin}>
              <Select name="slotStepMin" defaultValue={v.slotStepMin}>
                {grades.map((g) => (
                  <option key={g} value={String(g)}>
                    {g} minutos
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Intervalo entre atendimentos (minutos)" hint={`Múltiplo de ${limites.bufferMin.step}, até ${limites.bufferMin.max}.`} error={fields.bufferMin}>
              <Input name="bufferMin" type="number" inputMode="numeric" min={limites.bufferMin.min} max={limites.bufferMin.max} step={limites.bufferMin.step} defaultValue={v.bufferMin} />
            </Field>
            <Field label="Antecedência mínima (minutos)" hint="Quanto antes do horário o cliente ainda pode marcar." error={fields.minLeadMin}>
              <Input name="minLeadMin" type="number" inputMode="numeric" min={limites.minLeadMin.min} max={limites.minLeadMin.max} defaultValue={v.minLeadMin} />
            </Field>
            <Field label="Alcance da agenda (dias)" hint="Até quantos dias à frente se pode marcar." error={fields.maxAdvanceDays}>
              <Input name="maxAdvanceDays" type="number" inputMode="numeric" min={limites.maxAdvanceDays.min} max={limites.maxAdvanceDays.max} defaultValue={v.maxAdvanceDays} />
            </Field>
            <Field label="Prazo para o cliente mudar (minutos)" hint="Até quanto tempo antes o cliente pode remarcar ou cancelar." error={fields.customerChangeWindowMin}>
              <Input name="customerChangeWindowMin" type="number" inputMode="numeric" min={limites.customerChangeWindowMin.min} max={limites.customerChangeWindowMin.max} defaultValue={v.customerChangeWindowMin} />
            </Field>
            <Field
              label="Fuso horário"
              hint="Trocar o fuso não muda os agendamentos: os instantes ficam, e os horários passam a ser mostrados no fuso novo."
              error={fields.timeZone}
            >
              <Select name="timeZone" defaultValue={v.timeZone}>
                <optgroup label="Brasil">
                  {fusos.top.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Outros fusos">
                  {fusos.rest.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
          </div>
          <Checkbox name="autoConfirm" label="Confirmar os agendamentos sozinho" defaultChecked={v.autoConfirm === 'on'} />
        </>
      )}
    </ContaForm>
  )
}

/** Avisos por tipo e canal: uma caixa por combinação, com o nome completo para leitor de tela. */
export function AvisosForm({ action, valores, avisos }: { action: AcaoConta; valores: Campos; avisos: Array<{ kind: string; label: string }> }) {
  return (
    <ContaForm action={action} initial={estadoInicial(valores)} submit="Salvar avisos">
      {({ values: v }) => (
        <table className="af-matrix">
          <caption className="af-sr">Avisos por tipo e canal</caption>
          <thead>
            <tr>
              <th scope="col">Aviso</th>
              <th scope="col">E-mail</th>
              <th scope="col">Push</th>
            </tr>
          </thead>
          <tbody>
            {avisos.map((a) => (
              <tr key={a.kind}>
                <th scope="row">{a.label}</th>
                <td>
                  <Checkbox name={`${a.kind}__email`} label={<span className="af-sr">{a.label}: e-mail</span>} defaultChecked={v[`${a.kind}__email`] === 'on'} />
                </td>
                <td>
                  <Checkbox name={`${a.kind}__push`} label={<span className="af-sr">{a.label}: push</span>} defaultChecked={v[`${a.kind}__push`] === 'on'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ContaForm>
  )
}
